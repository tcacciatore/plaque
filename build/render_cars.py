# -*- coding: utf-8 -*-
"""Rendu des sprites de voitures (vue arrière) pour les modes Trafic, Parking
et Poursuite, ainsi que les véhicules de carrière.

Ray marching sur des surfaces implicites (SDF), vectorisé avec numpy.
Aucune dépendance à un moteur 3D ni à un modèle sous licence : les
carrosseries sont génériques et décrites ici.

Rendu : supersampling ×3, ombres douces, occlusion ambiante, éclairage
« route au couchant » — soleil chaud, contre-jour orangé, ciel bleu —
et reflets d'environnement procéduraux (ciel, ligne d'horizon, sol) sur
tout ce qui brille : vernis de peinture (double lobe + Fresnel), verre,
chromes, optiques de feux à réflecteur strié. Les peintures « chrome »,
« or », « argent », « bronze » sont métallisées : c'est la teinte qui
colore le reflet, pas la lumière diffuse.

La géométrie n'est rendue qu'UNE fois par silhouette ; les variantes de
couleur sont composées ensuite depuis les tampons d'éclairage (diffus,
vernis, reflet métallique, masque de peinture), sans relancer le rendu.

    arch -arm64 /usr/bin/python3 build/render_cars.py assets/cars [formes] [couleurs]
"""
import sys, os, math
import numpy as np
from PIL import Image

OUT = sys.argv[1] if len(sys.argv) > 1 else 'assets/cars'
W, H = 560, 380          # cadre de rendu
OUT_W = 520              # largeur du sprite livré, après recadrage
SS = int(os.environ.get('SS', 3))   # supersampling (rendu à SS×, réduit ensuite) ; SS=1 pour un calcul rapide de layout
RW, RH = W * SS, H * SS
MAX_STEPS, MAX_DIST, EPS = 110, 40.0, 0.0012

# ─────────────── primitives ───────────────
def rbox(p, b, r):
    """Boîte arrondie : p (…,3), b demi-dimensions, r rayon."""
    q = np.abs(p) - np.asarray(b) + r
    return (np.linalg.norm(np.maximum(q, 0.0), axis=-1)
            + np.minimum(np.max(q, axis=-1), 0.0) - r)

def cyl_x(p, half_len, radius, rr=0.0):
    """Cylindre d'axe X, arête arrondie de rayon rr."""
    d_axial = np.abs(p[..., 0]) - half_len + rr
    d_radial = np.linalg.norm(p[..., 1:3], axis=-1) - radius + rr
    return (np.minimum(np.maximum(d_axial, d_radial), 0.0)
            + np.linalg.norm(np.stack([np.maximum(d_axial, 0), np.maximum(d_radial, 0)], -1), axis=-1) - rr)

def cyl_z(p, half_len, radius, rr=0.0):
    d_axial = np.abs(p[..., 2]) - half_len + rr
    d_radial = np.linalg.norm(p[..., 0:2], axis=-1) - radius + rr
    return (np.minimum(np.maximum(d_axial, d_radial), 0.0)
            + np.linalg.norm(np.stack([np.maximum(d_axial, 0), np.maximum(d_radial, 0)], -1), axis=-1) - rr)

def cyl_y(p, half_len, radius, rr=0.0):
    d_axial = np.abs(p[..., 1]) - half_len + rr
    d_radial = np.linalg.norm(p[..., [0, 2]], axis=-1) - radius + rr
    return (np.minimum(np.maximum(d_axial, d_radial), 0.0)
            + np.linalg.norm(np.stack([np.maximum(d_axial, 0), np.maximum(d_radial, 0)], -1), axis=-1) - rr)

def sphere(p, r):
    return np.linalg.norm(p, axis=-1) - r

def smin(a, b, k):
    """Union lissée : raccorde la caisse et la cabine sans arête."""
    h = np.clip(0.5 + 0.5 * (b - a) / k, 0.0, 1.0)
    return b * (1 - h) + a * h - k * h * (1 - h)

def shear_z(p, amount, pivot_y):
    """Incline une primitive autour de l'axe X (custode fuyante)."""
    q = p.copy()
    q[..., 2] = q[..., 2] + amount * (q[..., 1] - pivot_y)
    return q

def tyre(p, half, r):
    """Pneu : flanc bombé, rainures circonférentielles et pavés de sculpture."""
    x = p[..., 0]
    rad = np.linalg.norm(p[..., 1:3], axis=-1)
    theta = np.arctan2(p[..., 2], p[..., 1])
    on_tread = np.clip((half - 0.03 - np.abs(x)) / 0.02, 0.0, 1.0)
    grooves = 0.014 * (0.5 + 0.5 * np.cos(x * 2 * np.pi / 0.075)) ** 7 * on_tread
    blocks = 0.006 * (0.5 + 0.5 * np.cos(theta * 34)) ** 5 * on_tread
    r_eff = r - grooves - blocks
    rr = 0.065
    qa = np.abs(x) - half + rr
    qr = rad - r_eff + rr
    return (np.minimum(np.maximum(qa, qr), 0.0)
            + np.linalg.norm(np.stack([np.maximum(qa, 0), np.maximum(qr, 0)], -1), axis=-1) - rr)

# ─────────────── matériaux ───────────────
(MAT_PAINT, MAT_GLASS, MAT_TYRE, MAT_RIM, MAT_LAMP, MAT_TRIM, MAT_PLATE,
 MAT_CHROME, MAT_LAMP_W, MAT_LAMP_A, MAT_CANVAS, MAT_HEAD) = range(1, 13)
VIEW = 'rear'                                   # 'front' : caméra devant la voiture (le rétroviseur)

def wheels(p, dists, mats, r, x, zs, half=0.13):
    """Roues : pneu sculpté, jante chromée en creux, moyeu."""
    for z in zs:
        for sx in (-1, 1):
            c = [sx * x, r, z]
            q = p - c
            dists.append(tyre(q, half, r)); mats.append(MAT_TYRE)
            rim = cyl_x(q, half + 0.008, r * 0.58, 0.02)
            dish = cyl_x(q - [sx * (half + 0.05), 0, 0], 0.05, r * 0.47)   # jante creuse
            dists.append(np.maximum(rim, -dish)); mats.append(MAT_CHROME)
            dists.append(cyl_x(q, half + 0.02, r * 0.14, 0.02)); mats.append(MAT_RIM)  # moyeu

def arches(body, p, x, r, zs, depth=0.24):
    """Passages de roue : la caisse est évidée autour de chaque roue."""
    for z in zs:
        for sx in (-1, 1):
            body = np.maximum(body, -cyl_x(p - [sx * x, r + 0.04, z], depth, r + 0.10, 0.03))
    return body

def mirrors(p, dists, mats, x, y, z):
    """Rétroviseurs : coque peinte sur une tige, débordant de la caisse."""
    for sx in (-1, 1):
        dists.append(rbox(p - [sx * x, y, z], [0.10, 0.055, 0.07], 0.035)); mats.append(MAT_PAINT)
        dists.append(rbox(p - [sx * (x - 0.10), y - 0.02, z], [0.06, 0.02, 0.03], 0.01)); mats.append(MAT_TRIM)

def exhaust(p, dists, mats, x, y, z, r=0.045):
    """Sortie d'échappement : embout chromé, intérieur sombre."""
    dists.append(cyl_z(p - [x, y, z], 0.07, r, 0.008)); mats.append(MAT_CHROME)
    dists.append(cyl_z(p - [x, y, z + 0.06], 0.02, r * 0.7)); mats.append(MAT_TRIM)

def lamp_cluster(p, dists, mats, sx, cx, cy, z, hw, hh, reverse=True, amber=True):
    """Bloc de feu : lentille rouge, feu de recul blanc côté intérieur, clignotant ambre dessous."""
    dists.append(rbox(p - [sx * cx, cy, z], [hw, hh, 0.05], 0.022)); mats.append(MAT_LAMP)
    if reverse:
        dists.append(rbox(p - [sx * (cx - hw + 0.09), cy + 0.01, z + 0.006], [0.07, hh * 0.55, 0.05], 0.012)); mats.append(MAT_LAMP_W)
    if amber:
        dists.append(rbox(p - [sx * cx, cy - hh + 0.02, z + 0.006], [hw - 0.02, 0.016, 0.05], 0.008)); mats.append(MAT_LAMP_A)
    dists.append(rbox(p - [sx * cx, cy + hh + 0.012, z - 0.005], [hw, 0.012, 0.045], 0.008)); mats.append(MAT_TRIM)

def bulge(shell, p, y_c, z_back, R=2.2):
    """Galbe la face arrière : la tôle devient légèrement convexe, le reflet y balaie l'horizon."""
    return np.maximum(shell, cyl_x(p - [0, y_c, z_back - R], 99.0, R))

def front_face(p, dists, mats, wid, y_low, y_lamp, z_front, hw=0.22, hh=0.085, plate_y=None, grille=0.34, style='car'):
    """L'avant d'un véhicule, soigné : blocs optiques à lentille (projecteur rond dans un
    boîtier chromé, feu de jour en bandeau, clignotant ambre), calandre cerclée de chrome
    à lames fines, logo, pli de capot, pare-chocs à jupe avec prise d'air en nid d'abeille
    et antibrouillards enchâssés, plaque avant. z_front < 0.
    style : 'car' (calandre horizontale), 'van' (calandre haute), 'sport' (bouche large)."""
    zf = z_front
    for sx in (-1, 1):
        cx = sx * (wid - 0.06 - hw)
        # boîtier chromé en creux, projecteur rond, feu de jour LED en bandeau, clignotant
        housing = rbox(p - [cx, y_lamp, zf + 0.03], [hw, hh, 0.05], 0.03)
        housing = np.maximum(housing, -rbox(p - [cx, y_lamp, zf - 0.03], [hw - 0.015, hh - 0.015, 0.03], 0.02))
        dists.append(housing); mats.append(MAT_CHROME)
        dists.append(rbox(p - [cx, y_lamp, zf + 0.005], [hw - 0.015, hh - 0.015, 0.02], 0.02)); mats.append(MAT_LAMP_W)   # fond du bloc
        px = cx + sx * (hw * 0.35)
        dists.append(cyl_z(p - [px, y_lamp + 0.005, zf - 0.005], 0.025, min(hh, hw * 0.5) * 0.85, 0.01)); mats.append(MAT_HEAD)   # projecteur
        dists.append(cyl_z(p - [px, y_lamp + 0.005, zf - 0.02], 0.02, min(hh, hw * 0.5) * 0.45, 0.01)); mats.append(MAT_CHROME)  # lentille
        dists.append(rbox(p - [cx - sx * (hw * 0.25), y_lamp + hh - 0.028, zf - 0.008], [hw * 0.55, 0.008, 0.02], 0.004)); mats.append(MAT_HEAD)   # feu de jour
        dists.append(rbox(p - [cx - sx * (hw * 0.25), y_lamp - hh + 0.024, zf - 0.006], [hw * 0.5, 0.012, 0.02], 0.006)); mats.append(MAT_LAMP_A)  # clignotant
        # antibrouillard enchâssé dans la jupe
        dists.append(cyl_z(p - [sx * (wid - 0.20), y_low + 0.085, zf + 0.02], 0.04, 0.055, 0.01)); mats.append(MAT_TRIM)
        dists.append(cyl_z(p - [sx * (wid - 0.20), y_low + 0.085, zf - 0.006], 0.025, 0.04, 0.01)); mats.append(MAT_LAMP_W)
    # calandre : cadre chromé, fond sombre, lames fines
    gh = hh + 0.012 if style != 'van' else hh + 0.06
    gy = y_lamp if style != 'van' else y_lamp + 0.02
    frame = rbox(p - [0, gy, zf + 0.02], [grille + 0.02, gh + 0.015, 0.03], 0.02)
    frame = np.maximum(frame, -rbox(p - [0, gy, zf - 0.02], [grille, gh, 0.03], 0.012))
    dists.append(frame); mats.append(MAT_CHROME)
    g = rbox(p - [0, gy, zf + 0.035], [grille, gh, 0.03], 0.012)
    n = int(round(gh / 0.024))
    for k in range(-n, n + 1):
        y = gy + k * (gh * 2 / max(1, 2 * n))
        if abs(y - gy) < gh - 0.01:
            g = np.maximum(g, -rbox(p - [0, y, zf], [grille - 0.01, 0.005, 0.02], 0.002))
    dists.append(g); mats.append(MAT_TRIM)
    dists.append(cyl_z(p - [0, gy, zf - 0.012], 0.02, 0.055, 0.012)); mats.append(MAT_CHROME)       # logo
    dists.append(cyl_z(p - [0, gy, zf - 0.03], 0.012, 0.03, 0.008)); mats.append(MAT_TRIM)
    # pli de capot, au-dessus de la calandre
    dists.append(rbox(p - [0, y_lamp + hh + 0.05, zf + 0.06], [wid - 0.10, 0.006, 0.08], 0.003)); mats.append(MAT_TRIM)
    # pare-chocs : jupe, prise d'air en nid d'abeille, lame chromée
    bumper = rbox(p - [0, y_low + 0.075, zf + 0.035], [wid + 0.005, 0.105, 0.065], 0.05)
    mouth_w = 0.34 if style != 'sport' else 0.50
    bumper = np.maximum(bumper, -rbox(p - [0, y_low + 0.05, zf - 0.02], [mouth_w, 0.04, 0.03], 0.012))
    dists.append(bumper); mats.append(MAT_TRIM)
    mesh = rbox(p - [0, y_low + 0.05, zf + 0.01], [mouth_w - 0.01, 0.035, 0.01], 0.004)
    for kx in np.arange(-mouth_w + 0.03, mouth_w, 0.06):
        mesh = np.maximum(mesh, -cyl_z(p - [kx, y_low + 0.05, zf + 0.01], 0.05, 0.02))
    dists.append(mesh); mats.append(MAT_RIM)
    dists.append(rbox(p - [0, y_low + 0.002, zf + 0.03], [wid - 0.02, 0.008, 0.07], 0.004)); mats.append(MAT_CHROME)    # lame
    dists.append(rbox(p - [0, (plate_y if plate_y else y_low + 0.20), zf - 0.045], [0.42, 0.115, 0.03], 0.012)); mats.append(MAT_PLATE)

def wipers(p, dists, mats, y, z, wid, tilt):
    """Deux essuie-glaces couchés au bas du pare-brise."""
    for sx, ang in ((-1, 0.35), (1, 0.25)):
        q = p - [sx * wid * 0.45, y, z]
        c, s_ = math.cos(ang * sx), math.sin(ang * sx)
        r = q.copy(); r[..., 0] = q[..., 0] * c - q[..., 1] * s_; r[..., 1] = q[..., 0] * s_ + q[..., 1] * c
        dists.append(rbox(shear_z(r, tilt, 0.0), [wid * 0.28, 0.006, 0.012], 0.004)); mats.append(MAT_TRIM)

def diffuser(bumper, p, y, z, xs, h=0.05):
    """Diffuseur : lames verticales creusées dans le bas du pare-chocs."""
    for x in xs:
        bumper = np.maximum(bumper, -rbox(p - [x, y, z], [0.007, h, 0.03], 0.003))
    return bumper

# ─────────────── silhouettes ───────────────
SHAPES = {
  'berline':  dict(len=2.05, wid=0.89, body_y=0.68, body_h=0.36, roof_y=1.13, roof_h=0.25,
                   roof_len=1.05, roof_wid=0.74, wheel_r=0.33, wheel_z=1.42, glass_tilt=0.40,
                   r_body=0.10, r_roof=0.09, antenna=True, lip=True),
  'suv':      dict(len=2.10, wid=0.93, body_y=0.80, body_h=0.44, roof_y=1.38, roof_h=0.29,
                   roof_len=1.28, roof_wid=0.80, wheel_r=0.40, wheel_z=1.45, glass_tilt=0.16,
                   r_body=0.09, r_roof=0.08, rails=True, spoiler=True),
  'citadine': dict(len=1.78, wid=0.85, body_y=0.68, body_h=0.34, roof_y=1.14, roof_h=0.28,
                   roof_len=0.90, roof_wid=0.72, wheel_r=0.31, wheel_z=1.20, glass_tilt=0.26,
                   r_body=0.10, r_roof=0.09, antenna=True, spoiler=True),
  'monospace': dict(len=2.15, wid=0.93, body_y=0.74, body_h=0.40, roof_y=1.40, roof_h=0.34,
                   roof_len=1.70, roof_wid=0.85, wheel_r=0.34, wheel_z=1.42, glass_tilt=0.30,
                   r_body=0.12, r_roof=0.12, rails=True, spoiler=True, vlamps=True),
}

# plaque : (centre y, z, demi-largeur, demi-hauteur) — pour la projection de layout.json
SHAPES['pickup']  = dict(kind='pickup',  plate=(0.78, 2.20, 0.40, 0.11), front_plate=(0.58, -2.28, 0.40, 0.11))
SHAPES['van']     = dict(kind='van',     plate=(0.72, 2.22, 0.40, 0.11), front_plate=(0.56, -2.22, 0.40, 0.11))
SHAPES['coupe']   = dict(kind='coupe',   plate=(0.60, 2.14, 0.40, 0.11), front_plate=(0.58, -2.14, 0.40, 0.11))
SHAPES['cabrio']  = dict(kind='cabrio',  plate=(0.56, 2.08, 0.40, 0.11), front_plate=(0.56, -2.07, 0.40, 0.11))
SHAPES['camper']  = dict(kind='camper',  plate=(0.70, 2.43, 0.40, 0.11), front_plate=(0.56, -2.04, 0.40, 0.11))
SHAPES['4x4']     = dict(kind='4x4',     plate=(0.66, 2.02, 0.40, 0.11), front_plate=(0.75, -1.97, 0.40, 0.11))
SHAPES['citerne'] = dict(kind='citerne', plate=(0.62, 2.36, 0.40, 0.11), front_plate=(0.80, -2.97, 0.40, 0.11))
SHAPES['supercar'] = dict(kind='supercar', plate=(0.58, 2.18, 0.40, 0.11), front_plate=(0.50, -2.18, 0.40, 0.11))
SHAPES['ancienne'] = dict(kind='ancienne', plate=(0.62, 2.02, 0.40, 0.11), front_plate=(0.62, -2.01, 0.40, 0.11))
SHAPES['camion']   = dict(kind='camion',   plate=(0.66, 2.36, 0.40, 0.11), front_plate=(0.88, -3.00, 0.40, 0.11))

def scene_pickup(p, dists, mats):
    wheels(p, dists, mats, 0.38, 0.86, (1.50, -1.40), 0.15)
    chassis = rbox(p - [0, 0.62, 0], [0.92, 0.24, 2.28], 0.08)
    chassis = arches(chassis, p, 0.92, 0.38, (1.50, -1.40))
    cab = rbox(p - [0, 1.24, -0.95], [0.86, 0.38, 0.72], 0.10)
    dists.append(smin(chassis, cab, 0.10)); mats.append(MAT_PAINT)
    mirrors(p, dists, mats, 0.98, 1.22, -1.55)
    # l'avant : pare-brise de cabine, capot haut, calandre massive
    dists.append(rbox(shear_z(p - [0, 1.30, -1.66], 0.35, 0.0), [0.74, 0.28, 0.04], 0.03)); mats.append(MAT_TRIM)
    dists.append(rbox(shear_z(p - [0, 1.30, -1.67], 0.35, 0.0), [0.68, 0.23, 0.05], 0.02)); mats.append(MAT_GLASS)
    dists.append(rbox(p - [0, 0.90, -1.95], [0.86, 0.06, 0.34], 0.03)); mats.append(MAT_PAINT)     # capot
    front_face(p, dists, mats, 0.92, 0.38, 0.72, -2.30, hw=0.18, hh=0.10, grille=0.38)
    # benne ouverte : une boîte évidée, ridelles nervurées
    outer = rbox(p - [0, 0.96, 0.85], [0.92, 0.30, 1.36], 0.05)
    inner = rbox(p - [0, 1.06, 0.85], [0.80, 0.30, 1.24], 0.03)
    benne = np.maximum(outer, -inner)
    for x in (-0.55, -0.18, 0.18, 0.55):
        benne = np.maximum(benne, -rbox(p - [x, 0.98, 2.21], [0.012, 0.20, 0.02], 0.004))
    dists.append(benne); mats.append(MAT_PAINT)
    dists.append(rbox(p - [0, 0.80, 0.85], [0.80, 0.02, 1.24], 0.01)); mats.append(MAT_TRIM)   # plancher
    dists.append(rbox(p - [0, 1.26, 0.85], [0.925, 0.012, 1.37], 0.006)); mats.append(MAT_TRIM)  # protection de ridelle
    # lunette de cabine + joint + troisième feu stop
    dists.append(rbox(p - [0, 1.30, -0.21], [0.72, 0.26, 0.04], 0.03)); mats.append(MAT_TRIM)
    dists.append(rbox(p - [0, 1.30, -0.20], [0.64, 0.20, 0.05], 0.02)); mats.append(MAT_GLASS)
    dists.append(rbox(p - [0, 1.58, -0.21], [0.16, 0.014, 0.03], 0.006)); mats.append(MAT_LAMP)
    # feux verticaux aux coins de la benne, pare-chocs chromé, plaque, échappement
    for sx in (-1, 1):
        dists.append(rbox(p - [sx * 0.84, 0.97, 2.19], [0.06, 0.22, 0.04], 0.02)); mats.append(MAT_LAMP)
        dists.append(rbox(p - [sx * 0.84, 0.90, 2.196], [0.045, 0.05, 0.04], 0.012)); mats.append(MAT_LAMP_W)
        dists.append(rbox(p - [sx * 0.84, 0.78, 2.196], [0.045, 0.025, 0.04], 0.01)); mats.append(MAT_LAMP_A)
    bumper = rbox(p - [0, 0.42, 2.22], [0.96, 0.09, 0.07], 0.04)
    dists.append(bumper); mats.append(MAT_CHROME)
    dists.append(rbox(p - [0, 0.78, 2.21], [0.40, 0.11, 0.03], 0.012)); mats.append(MAT_PLATE)
    exhaust(p, dists, mats, 0.62, 0.36, 2.25, 0.04)

def scene_van(p, dists, mats):
    wheels(p, dists, mats, 0.34, 0.84, (1.40, -1.45), 0.13)
    body = rbox(p - [0, 1.14, 0], [0.90, 0.78, 2.22], 0.12)
    body = arches(body, p, 0.90, 0.34, (1.40, -1.45))
    body = bulge(body, p, 1.14, 2.22, 6.0)
    # nervures de flanc et joint de porte arrière
    for y in (0.75, 1.62):
        body = np.maximum(body, -rbox(p - [0, y, 0.2], [0.905, 0.008, 1.9], 0.003))
    body = np.maximum(body, -rbox(p - [0, 1.10, 2.22], [0.012, 0.74, 0.02], 0.004))
    dists.append(body); mats.append(MAT_PAINT)
    mirrors(p, dists, mats, 1.00, 1.42, -1.75)
    # l'avant : grand pare-brise incliné, capot court, façade
    dists.append(rbox(shear_z(p - [0, 1.50, -2.16], 0.40, 0.0), [0.78, 0.30, 0.04], 0.03)); mats.append(MAT_TRIM)
    dists.append(rbox(shear_z(p - [0, 1.50, -2.17], 0.40, 0.0), [0.72, 0.25, 0.05], 0.02)); mats.append(MAT_GLASS)
    front_face(p, dists, mats, 0.90, 0.36, 0.86, -2.24, hw=0.16, hh=0.11, grille=0.30, style='van')
    # portes arrière : deux vitres verticales, bas de porte, poignées
    for sx in (-1, 1):
        dists.append(rbox(p - [sx * 0.43, 1.44, 2.21], [0.36, 0.31, 0.04], 0.03)); mats.append(MAT_TRIM)
        dists.append(rbox(p - [sx * 0.43, 1.44, 2.22], [0.31, 0.26, 0.05], 0.02)); mats.append(MAT_GLASS)
        dists.append(rbox(p - [sx * 0.10, 1.00, 2.235], [0.06, 0.015, 0.012], 0.006)); mats.append(MAT_TRIM)
    dists.append(rbox(p - [0, 0.98, 2.225], [0.86, 0.008, 0.02], 0.004)); mats.append(MAT_TRIM)
    for sx in (-1, 1):
        dists.append(rbox(p - [sx * 0.85, 1.02, 2.20], [0.05, 0.30, 0.04], 0.02)); mats.append(MAT_LAMP)
        dists.append(rbox(p - [sx * 0.85, 0.92, 2.206], [0.04, 0.06, 0.04], 0.01)); mats.append(MAT_LAMP_W)
        dists.append(rbox(p - [sx * 0.85, 0.78, 2.206], [0.04, 0.03, 0.04], 0.01)); mats.append(MAT_LAMP_A)
    dists.append(rbox(p - [0, 1.90, 2.20], [0.14, 0.014, 0.03], 0.006)); mats.append(MAT_LAMP)
    dists.append(rbox(p - [0, 0.42, 2.24], [0.93, 0.10, 0.07], 0.045)); mats.append(MAT_TRIM)
    dists.append(rbox(p - [0, 0.72, 2.23], [0.40, 0.11, 0.03], 0.012)); mats.append(MAT_PLATE)
    exhaust(p, dists, mats, -0.60, 0.34, 2.27, 0.035)

def scene_coupe(p, dists, mats):
    wheels(p, dists, mats, 0.34, 0.90, (1.42, -1.38), 0.17)
    body = rbox(p - [0, 0.62, 0], [0.95, 0.24, 2.12], 0.14)
    body = arches(body, p, 0.95, 0.34, (1.42, -1.38))
    roof = rbox(shear_z(p - [0, 1.00, -0.30], 0.95, 0.0), [0.78, 0.17, 0.95], 0.12)
    shell = smin(body, roof, 0.26)
    shell = bulge(shell, p, 0.62, 2.12)
    shell = np.maximum(shell, -rbox(p - [0, 0.75, 2.12], [0.72, 0.005, 0.02], 0.002))   # joint de coffre
    dists.append(shell); mats.append(MAT_PAINT)
    mirrors(p, dists, mats, 1.02, 1.00, -1.20)
    # l'avant : pare-brise couché, capot plongeant, façade basse
    dists.append(rbox(shear_z(p - [0, 1.00, -1.26], 0.95, 0.0), [0.72, 0.155, 0.05], 0.03)); mats.append(MAT_TRIM)
    dists.append(rbox(shear_z(p - [0, 1.00, -1.29], 0.95, 0.0), [0.66, 0.12, 0.05], 0.02)); mats.append(MAT_GLASS)
    front_face(p, dists, mats, 0.95, 0.38, 0.70, -2.14, hw=0.24, hh=0.06, grille=0.30)
    # lunette très couchée + troisième feu stop
    dists.append(rbox(shear_z(p - [0, 1.00, 0.48], 0.95, 0.0), [0.68, 0.135, 0.04], 0.03)); mats.append(MAT_TRIM)
    dists.append(rbox(shear_z(p - [0, 1.00, 0.49], 0.95, 0.0), [0.62, 0.10, 0.05], 0.02)); mats.append(MAT_GLASS)
    # becquet sur ses supports
    dists.append(rbox(p - [0, 0.98, 1.92], [0.80, 0.022, 0.13], 0.02)); mats.append(MAT_PAINT)
    dists.append(rbox(p - [0, 0.98, 2.04], [0.30, 0.012, 0.015], 0.005)); mats.append(MAT_LAMP)
    for sx in (-1, 1):
        dists.append(rbox(p - [sx * 0.62, 0.90, 1.94], [0.05, 0.07, 0.06], 0.01)); mats.append(MAT_TRIM)
    # bandeau de feux sur toute la largeur, diffuseur, double sortie
    dists.append(rbox(p - [0, 0.76, 2.11], [0.88, 0.035, 0.04], 0.02)); mats.append(MAT_LAMP)
    for sx in (-1, 1):
        dists.append(rbox(p - [sx * 0.55, 0.76, 2.116], [0.06, 0.02, 0.04], 0.008)); mats.append(MAT_LAMP_W)
    bumper = rbox(p - [0, 0.43, 2.15], [0.96, 0.09, 0.07], 0.05)
    bumper = diffuser(bumper, p, 0.40, 2.22, (-0.30, -0.15, 0.0, 0.15, 0.30), 0.05)
    dists.append(bumper); mats.append(MAT_TRIM)
    for sx in (-1, 1):
        exhaust(p, dists, mats, sx * 0.55, 0.40, 2.20, 0.05)
    dists.append(rbox(p - [0, 0.60, 2.13], [0.40, 0.11, 0.03], 0.012)); mats.append(MAT_PLATE)

def scene_cabrio(p, dists, mats):
    wheels(p, dists, mats, 0.33, 0.88, (1.35, -1.32), 0.14)
    body = rbox(p - [0, 0.60, 0], [0.92, 0.24, 2.05], 0.14)
    body = arches(body, p, 0.92, 0.33, (1.35, -1.32))
    body = bulge(body, p, 0.60, 2.05)
    body = np.maximum(body, -rbox(p - [0, 0.72, 2.05], [0.70, 0.005, 0.02], 0.002))
    dists.append(body); mats.append(MAT_PAINT)
    mirrors(p, dists, mats, 1.00, 0.98, -1.15)
    # capote repliée derrière les sièges, dossiers et appuie-têtes visibles par-dessus la caisse
    dists.append(rbox(p - [0, 0.90, 0.95], [0.80, 0.07, 0.30], 0.05)); mats.append(MAT_CANVAS)
    for sx in (-1, 1):
        dists.append(rbox(p - [sx * 0.40, 0.92, 0.30], [0.22, 0.14, 0.08], 0.04)); mats.append(MAT_TRIM)
        dists.append(rbox(p - [sx * 0.40, 1.12, 0.26], [0.13, 0.08, 0.06], 0.04)); mats.append(MAT_TRIM)
        dists.append(rbox(p - [sx * 0.40, 1.02, 0.36], [0.12, 0.10, 0.03], 0.02)); mats.append(MAT_CANVAS)
    # pare-brise, incliné vers l'avant, vu à travers l'habitacle
    dists.append(rbox(shear_z(p - [0, 1.10, -0.75], -0.55, 0.0), [0.76, 0.24, 0.03], 0.025)); mats.append(MAT_TRIM)
    dists.append(rbox(shear_z(p - [0, 1.10, -0.74], -0.55, 0.0), [0.70, 0.20, 0.035], 0.02)); mats.append(MAT_GLASS)
    front_face(p, dists, mats, 0.92, 0.36, 0.70, -2.07, hw=0.22, hh=0.07, grille=0.30)
    for sx in (-1, 1):
        lamp_cluster(p, dists, mats, sx, 0.60, 0.72, 2.06, 0.25, 0.07)
    bumper = rbox(p - [0, 0.43, 2.09], [0.95, 0.09, 0.07], 0.05)
    dists.append(bumper); mats.append(MAT_TRIM)
    for sx in (-1, 1):
        exhaust(p, dists, mats, sx * 0.55, 0.40, 2.14, 0.045)
    dists.append(rbox(p - [0, 0.56, 2.07], [0.40, 0.11, 0.03], 0.012)); mats.append(MAT_PLATE)

def scene_camper(p, dists, mats):
    wheels(p, dists, mats, 0.36, 0.92, (1.50, -1.45), 0.13)
    cell = rbox(p - [0, 1.10, 0.20], [1.02, 0.74, 2.22], 0.10)
    cell = arches(cell, p, 1.02, 0.36, (1.50, -1.45))
    cell = bulge(cell, p, 1.10, 2.42, 7.0)
    cell = np.maximum(cell, -rbox(p - [-0.52, 1.10, 2.42], [0.008, 0.58, 0.02], 0.003))   # porte
    dists.append(cell); mats.append(MAT_PAINT)
    mirrors(p, dists, mats, 1.12, 1.40, -1.75)
    # l'avant : pare-brise panoramique, casquette, façade
    dists.append(rbox(shear_z(p - [0, 1.42, -1.96], -0.30, 0.0), [0.86, 0.34, 0.04], 0.03)); mats.append(MAT_TRIM)
    dists.append(rbox(shear_z(p - [0, 1.42, -1.98], -0.30, 0.0), [0.80, 0.29, 0.05], 0.02)); mats.append(MAT_GLASS)
    dists.append(rbox(p - [0, 1.84, -2.02], [0.90, 0.03, 0.10], 0.02)); mats.append(MAT_PAINT)      # casquette
    front_face(p, dists, mats, 1.02, 0.36, 0.84, -2.04, hw=0.18, hh=0.10, grille=0.34, style='van')
    # fenêtre haute, bande décorative, échelle à droite, lanterneau
    dists.append(rbox(p - [0.10, 1.52, 2.41], [0.34, 0.22, 0.04], 0.03)); mats.append(MAT_TRIM)
    dists.append(rbox(p - [0.10, 1.52, 2.42], [0.29, 0.17, 0.05], 0.02)); mats.append(MAT_GLASS)
    dists.append(rbox(p - [0, 1.02, 2.415], [1.0, 0.03, 0.012], 0.006)); mats.append(MAT_TRIM)
    dists.append(rbox(p - [0, 1.20, 2.415], [1.0, 0.012, 0.010], 0.004)); mats.append(MAT_CHROME)
    dists.append(rbox(p - [-0.3, 1.86, 0.4], [0.28, 0.03, 0.30], 0.02)); mats.append(MAT_TRIM)
    for i in range(5):
        dists.append(rbox(p - [0.78, 0.62 + i * 0.27, 2.44], [0.13, 0.018, 0.02], 0.01)); mats.append(MAT_CHROME)
    for sx in (-1, 1):
        dists.append(rbox(p - [0.78 + sx * 0.13, 1.18, 2.44], [0.018, 0.62, 0.02], 0.01)); mats.append(MAT_CHROME)
    for sx in (-1, 1):
        dists.append(rbox(p - [sx * 0.94, 0.86, 2.39], [0.06, 0.19, 0.04], 0.02)); mats.append(MAT_LAMP)
        dists.append(rbox(p - [sx * 0.94, 0.80, 2.396], [0.045, 0.05, 0.04], 0.01)); mats.append(MAT_LAMP_W)
        dists.append(rbox(p - [sx * 0.94, 0.70, 2.396], [0.045, 0.02, 0.04], 0.01)); mats.append(MAT_LAMP_A)
    dists.append(rbox(p - [0, 0.42, 2.43], [1.03, 0.10, 0.07], 0.045)); mats.append(MAT_TRIM)
    dists.append(rbox(p - [0, 0.70, 2.425], [0.40, 0.11, 0.03], 0.012)); mats.append(MAT_PLATE)

def scene_4x4(p, dists, mats):
    wheels(p, dists, mats, 0.42, 0.90, (1.35, -1.32), 0.18)
    body = rbox(p - [0, 0.95, 0], [0.90, 0.40, 1.95], 0.07)
    body = arches(body, p, 0.90, 0.42, (1.35, -1.32), 0.20)
    cab = rbox(p - [0, 1.55, -0.10], [0.84, 0.28, 1.35], 0.06)
    dists.append(smin(body, cab, 0.05)); mats.append(MAT_PAINT)
    mirrors(p, dists, mats, 0.98, 1.50, -1.35)
    # l'avant : pare-brise droit, capot plat, façade et pare-buffle
    dists.append(rbox(p - [0, 1.60, -1.45], [0.72, 0.22, 0.04], 0.03)); mats.append(MAT_TRIM)
    dists.append(rbox(p - [0, 1.60, -1.46], [0.66, 0.17, 0.05], 0.02)); mats.append(MAT_GLASS)
    front_face(p, dists, mats, 0.90, 0.55, 1.05, -1.97, hw=0.16, hh=0.10, grille=0.36)
    dists.append(rbox(p - [0, 0.86, -2.06], [0.70, 0.025, 0.025], 0.012)); mats.append(MAT_CHROME)  # pare-buffle
    for sx in (-1, 1):
        dists.append(rbox(p - [sx * 0.55, 0.70, -2.06], [0.025, 0.18, 0.025], 0.012)); mats.append(MAT_CHROME)
    # élargisseurs d'ailes
    for z in (1.35, -1.32):
        for sx in (-1, 1):
            flare = cyl_x(p - [sx * 0.92, 0.46, z], 0.06, 0.56, 0.03)
            flare = np.maximum(flare, -cyl_x(p - [sx * 0.92, 0.46, z], 0.10, 0.50))
            flare = np.maximum(flare, 0.55 - p[..., 1])
            dists.append(flare); mats.append(MAT_TRIM)
    # lunette, roue de secours sur la porte, galerie de toit
    dists.append(rbox(p - [0, 1.66, 1.24], [0.66, 0.19, 0.04], 0.03)); mats.append(MAT_TRIM)
    dists.append(rbox(p - [0, 1.66, 1.25], [0.60, 0.15, 0.05], 0.02)); mats.append(MAT_GLASS)
    dists.append(cyl_z(p - [0, 1.12, 2.04], 0.12, 0.33, 0.05)); mats.append(MAT_TYRE)
    dists.append(np.maximum(cyl_z(p - [0, 1.12, 2.16], 0.02, 0.19, 0.01), -cyl_z(p - [0, 1.12, 2.19], 0.02, 0.15))); mats.append(MAT_CHROME)
    for sx in (-1, 1):
        dists.append(rbox(p - [sx * 0.62, 1.88, -0.10], [0.03, 0.03, 1.15], 0.015)); mats.append(MAT_TRIM)
    dists.append(rbox(p - [0, 1.88, 1.02], [0.64, 0.03, 0.03], 0.015)); mats.append(MAT_TRIM)
    for x in (-0.3, 0.0, 0.3):
        dists.append(rbox(p - [x, 1.88, -0.10], [0.015, 0.02, 1.10], 0.01)); mats.append(MAT_TRIM)
    for sx in (-1, 1):
        dists.append(rbox(p - [sx * 0.86, 1.02, 1.97], [0.06, 0.20, 0.04], 0.02)); mats.append(MAT_LAMP)
        dists.append(rbox(p - [sx * 0.86, 0.95, 1.976], [0.045, 0.05, 0.04], 0.01)); mats.append(MAT_LAMP_W)
        dists.append(rbox(p - [sx * 0.86, 0.85, 1.976], [0.045, 0.02, 0.04], 0.01)); mats.append(MAT_LAMP_A)
    dists.append(rbox(p - [0, 0.48, 2.00], [0.97, 0.12, 0.10], 0.05)); mats.append(MAT_TRIM)
    dists.append(rbox(p - [0, 0.36, 2.02], [0.80, 0.02, 0.09], 0.01)); mats.append(MAT_CHROME)   # sabot
    dists.append(rbox(p - [0, 0.66, 2.01], [0.40, 0.11, 0.03], 0.012)); mats.append(MAT_PLATE)
    exhaust(p, dists, mats, -0.70, 0.38, 2.06, 0.04)

def scene_citerne(p, dists, mats):
    # deux essieux arrière jumelés, châssis, cuve cylindrique, cabine devant
    wheels(p, dists, mats, 0.40, 0.86, (1.55, 0.75, -1.55), 0.16)
    dists.append(rbox(p - [0, 0.62, 0], [0.92, 0.12, 2.30], 0.04)); mats.append(MAT_TRIM)
    for z in (1.55, 0.75):
        dists.append(rbox(p - [0, 0.55, z], [0.98, 0.04, 0.20], 0.02)); mats.append(MAT_TRIM)   # garde-boue
    tank = cyl_z(p - [0, 1.22, 0.30], 1.85, 0.60)
    dists.append(tank); mats.append(MAT_PAINT)
    dists.append(cyl_z(p - [0, 1.22, 0.30], 1.88, 0.55, 0.05)); mats.append(MAT_PAINT)   # fonds bombés
    for z in (-0.9, 0.3, 1.5):                                                     # cerclages
        dists.append(cyl_z(p - [0, 1.22, z], 0.05, 0.625, 0.01)); mats.append(MAT_CHROME)
    cab = rbox(p - [0, 1.18, -2.55], [0.86, 0.58, 0.40], 0.08)
    dists.append(cab); mats.append(MAT_PAINT)
    mirrors(p, dists, mats, 0.98, 1.45, -2.60)
    # l'avant de la cabine : pare-brise haut, façade
    dists.append(rbox(p - [0, 1.42, -2.94], [0.74, 0.28, 0.04], 0.03)); mats.append(MAT_TRIM)
    dists.append(rbox(p - [0, 1.42, -2.95], [0.68, 0.23, 0.05], 0.02)); mats.append(MAT_GLASS)
    front_face(p, dists, mats, 0.86, 0.60, 0.94, -2.97, hw=0.16, hh=0.09, grille=0.32, style='van')
    # échelle à gauche, passerelle, vanne, feux, pare-chocs, plaque
    for i in range(5):
        dists.append(rbox(p - [-0.70, 0.66 + i * 0.26, 2.20], [0.11, 0.016, 0.02], 0.008)); mats.append(MAT_CHROME)
    for sx in (-1, 1):
        dists.append(rbox(p - [-0.70 + sx * 0.11, 1.18, 2.20], [0.016, 0.60, 0.02], 0.008)); mats.append(MAT_CHROME)
    dists.append(rbox(p - [0, 1.85, 0.30], [0.30, 0.015, 1.7], 0.008)); mats.append(MAT_TRIM)
    dists.append(cyl_z(p - [0.35, 0.78, 2.22], 0.06, 0.07, 0.01)); mats.append(MAT_CHROME)
    for sx in (-1, 1):
        dists.append(rbox(p - [sx * 0.80, 0.72, 2.31], [0.10, 0.14, 0.04], 0.02)); mats.append(MAT_LAMP)
        dists.append(rbox(p - [sx * 0.80, 0.66, 2.316], [0.06, 0.04, 0.04], 0.01)); mats.append(MAT_LAMP_W)
        dists.append(rbox(p - [sx * 0.80, 0.80, 2.316], [0.08, 0.02, 0.04], 0.01)); mats.append(MAT_LAMP_A)
    dists.append(rbox(p - [0, 0.44, 2.34], [0.95, 0.09, 0.07], 0.04)); mats.append(MAT_TRIM)
    dists.append(rbox(p - [0, 0.62, 2.35], [0.40, 0.11, 0.03], 0.012)); mats.append(MAT_PLATE)
    # marquage danger : plaque orange sous la cuve
    dists.append(rbox(p - [0, 0.92, 2.33], [0.20, 0.07, 0.02], 0.01)); mats.append(MAT_LAMP_A)

def scene_supercar(p, dists, mats):
    """Supercar : caisse basse et large, hanches marquées, aileron, quadruple sortie."""
    wheels(p, dists, mats, 0.35, 0.96, (1.45, -1.40), 0.19)
    body = rbox(p - [0, 0.52, 0], [0.98, 0.22, 2.16], 0.14)
    for sx in (-1, 1):   # hanches
        body = smin(body, rbox(p - [sx * 0.86, 0.66, 1.15], [0.18, 0.16, 0.80], 0.14), 0.18)
    body = arches(body, p, 1.00, 0.35, (1.45, -1.40), 0.26)
    roof = rbox(shear_z(p - [0, 0.86, -0.55], 1.10, 0.0), [0.70, 0.15, 0.80], 0.12)
    shell = smin(body, roof, 0.22)
    shell = bulge(shell, p, 0.56, 2.16, 2.6)
    # capot moteur vitré, ouïes
    for x in (-0.45, -0.25, -0.05, 0.15, 0.35):
        shell = np.maximum(shell, -rbox(p - [x + 0.05, 0.74, 1.35], [0.05, 0.02, 0.32], 0.006))
    dists.append(shell); mats.append(MAT_PAINT)
    mirrors(p, dists, mats, 1.06, 0.88, -1.30)
    # l'avant : pare-brise couché, capot plongeant, phares effilés, grande bouche
    dists.append(rbox(shear_z(p - [0, 0.86, -1.36], 1.10, 0.0), [0.66, 0.14, 0.05], 0.03)); mats.append(MAT_TRIM)
    dists.append(rbox(shear_z(p - [0, 0.86, -1.39], 1.10, 0.0), [0.60, 0.11, 0.05], 0.02)); mats.append(MAT_GLASS)
    front_face(p, dists, mats, 0.98, 0.30, 0.60, -2.18, hw=0.26, hh=0.045, grille=0.36, style='sport')
    dists.append(rbox(shear_z(p - [0, 0.86, 0.10], 1.10, 0.0), [0.60, 0.12, 0.04], 0.03)); mats.append(MAT_TRIM)
    dists.append(rbox(shear_z(p - [0, 0.86, 0.11], 1.10, 0.0), [0.54, 0.09, 0.05], 0.02)); mats.append(MAT_GLASS)
    # aileron sur deux pylônes, feu stop central
    dists.append(rbox(p - [0, 1.06, 1.90], [0.96, 0.02, 0.15], 0.015)); mats.append(MAT_PAINT)
    for sx in (-1, 1):
        dists.append(rbox(p - [sx * 0.72, 0.92, 1.92], [0.04, 0.14, 0.09], 0.01)); mats.append(MAT_TRIM)
        dists.append(rbox(p - [sx * 0.96, 1.10, 1.90], [0.015, 0.06, 0.15], 0.01)); mats.append(MAT_PAINT)
    dists.append(rbox(p - [0, 1.06, 2.04], [0.26, 0.010, 0.012], 0.004)); mats.append(MAT_LAMP)
    # feux fins, grille arrière, diffuseur agressif, quatre sorties
    for sx in (-1, 1):
        dists.append(rbox(p - [sx * 0.62, 0.72, 2.16], [0.30, 0.03, 0.04], 0.015)); mats.append(MAT_LAMP)
        dists.append(rbox(p - [sx * 0.40, 0.72, 2.166], [0.05, 0.018, 0.04], 0.006)); mats.append(MAT_LAMP_W)
    grille = rbox(p - [0, 0.62, 2.16], [0.30, 0.05, 0.03], 0.01)
    for x in np.arange(-0.26, 0.27, 0.06):
        grille = np.maximum(grille, -rbox(p - [x, 0.62, 2.19], [0.012, 0.05, 0.02], 0.002))
    dists.append(grille); mats.append(MAT_TRIM)
    bumper = rbox(p - [0, 0.38, 2.18], [1.00, 0.10, 0.08], 0.04)
    bumper = diffuser(bumper, p, 0.34, 2.26, (-0.60, -0.42, -0.24, 0.24, 0.42, 0.60), 0.06)
    dists.append(bumper); mats.append(MAT_TRIM)
    for x in (-0.24, -0.10, 0.10, 0.24):
        exhaust(p, dists, mats, x, 0.40, 2.24, 0.045)
    dists.append(rbox(p - [0, 0.58, 2.17], [0.40, 0.11, 0.03], 0.012)); mats.append(MAT_PLATE)

def scene_ancienne(p, dists, mats):
    """Voiture ancienne : formes rondes, ailes séparées, pare-chocs et feux ronds chromés."""
    wheels(p, dists, mats, 0.34, 0.74, (1.30, -1.25), 0.11)
    body = rbox(p - [0, 0.70, 0], [0.74, 0.30, 1.85], 0.26)
    roof = rbox(shear_z(p - [0, 1.16, -0.35], 0.55, 0.0), [0.66, 0.30, 0.90], 0.24)
    shell = smin(body, roof, 0.30)
    shell = np.maximum(shell, -rbox(p - [0, 0.88, 1.86], [0.42, 0.004, 0.03], 0.002))   # joint de malle
    dists.append(shell); mats.append(MAT_PAINT)
    # ailes bombées au-dessus des roues, marchepied
    for z in (1.30, -1.25):
        for sx in (-1, 1):
            f = cyl_x(p - [sx * 0.78, 0.40, z], 0.13, 0.50, 0.08)
            f = np.maximum(f, -cyl_x(p - [sx * 0.78, 0.40, z], 0.20, 0.42))
            f = np.maximum(f, 0.42 - p[..., 1])
            dists.append(f); mats.append(MAT_PAINT)
    for sx in (-1, 1):
        dists.append(rbox(p - [sx * 0.82, 0.40, 0.0], [0.10, 0.02, 0.80], 0.015)); mats.append(MAT_TRIM)
    mirrors(p, dists, mats, 0.84, 1.10, -1.10)
    # l'avant : pare-brise presque droit, phares ronds chromés sur les ailes, calandre verticale
    dists.append(rbox(shear_z(p - [0, 1.16, -1.22], -0.55, 0.0), [0.50, 0.20, 0.04], 0.10)); mats.append(MAT_TRIM)
    dists.append(rbox(shear_z(p - [0, 1.16, -1.24], -0.55, 0.0), [0.45, 0.16, 0.05], 0.08)); mats.append(MAT_GLASS)
    for sx in (-1, 1):
        dists.append(cyl_z(p - [sx * 0.62, 0.94, -1.86], 0.08, 0.13, 0.02)); mats.append(MAT_CHROME)
        dists.append(cyl_z(p - [sx * 0.62, 0.94, -1.92], 0.03, 0.10, 0.03)); mats.append(MAT_HEAD)
    g = rbox(p - [0, 0.78, -1.87], [0.22, 0.28, 0.04], 0.06)
    for k in range(-3, 4):
        g = np.maximum(g, -rbox(p - [k * 0.055, 0.78, -1.92], [0.01, 0.24, 0.02], 0.003))
    dists.append(g); mats.append(MAT_CHROME)
    dists.append(rbox(p - [0, 0.46, -2.00], [0.86, 0.05, 0.05], 0.04)); mats.append(MAT_CHROME)
    for sx in (-1, 1):
        dists.append(rbox(p - [sx * 0.50, 0.48, -2.04], [0.05, 0.08, 0.04], 0.03)); mats.append(MAT_CHROME)
    dists.append(rbox(p - [0, 0.62, -2.01], [0.40, 0.11, 0.03], 0.012)); mats.append(MAT_PLATE)
    # lunette ovale, feux ronds, pare-chocs chromé à butoirs, roue de secours sur la malle
    dists.append(rbox(shear_z(p - [0, 1.16, 0.53], 0.55, 0.0), [0.44, 0.15, 0.04], 0.12)); mats.append(MAT_TRIM)
    dists.append(rbox(shear_z(p - [0, 1.16, 0.54], 0.55, 0.0), [0.39, 0.11, 0.05], 0.10)); mats.append(MAT_GLASS)
    for sx in (-1, 1):
        dists.append(cyl_z(p - [sx * 0.62, 0.86, 1.88], 0.05, 0.075, 0.01)); mats.append(MAT_CHROME)
        dists.append(cyl_z(p - [sx * 0.62, 0.86, 1.92], 0.03, 0.06, 0.02)); mats.append(MAT_LAMP)
        dists.append(cyl_z(p - [sx * 0.62, 0.70, 1.88], 0.04, 0.045, 0.01)); mats.append(MAT_CHROME)
        dists.append(cyl_z(p - [sx * 0.62, 0.70, 1.91], 0.03, 0.035, 0.01)); mats.append(MAT_LAMP_A)
    dists.append(cyl_z(p - [0, 0.98, 1.98], 0.09, 0.30, 0.06)); mats.append(MAT_TYRE)
    dists.append(np.maximum(cyl_z(p - [0, 0.98, 2.07], 0.02, 0.17, 0.01), -cyl_z(p - [0, 0.98, 2.09], 0.02, 0.13))); mats.append(MAT_CHROME)
    dists.append(rbox(p - [0, 0.46, 2.00], [0.86, 0.05, 0.05], 0.04)); mats.append(MAT_CHROME)
    for sx in (-1, 1):
        dists.append(rbox(p - [sx * 0.50, 0.48, 2.04], [0.05, 0.08, 0.04], 0.03)); mats.append(MAT_CHROME)
    dists.append(rbox(p - [0, 0.62, 2.01], [0.40, 0.11, 0.03], 0.012)); mats.append(MAT_PLATE)
    exhaust(p, dists, mats, 0.50, 0.36, 2.02, 0.03)

def scene_camion(p, dists, mats):
    """Camion porteur : caisse fourgon à rideau nervuré, roues jumelées, barre anti-encastrement."""
    wheels(p, dists, mats, 0.40, 0.82, (1.25, -1.60), 0.15)
    wheels(p, dists, mats, 0.40, 0.55, (1.25,), 0.12)
    dists.append(rbox(p - [0, 0.60, 0], [0.90, 0.10, 2.30], 0.03)); mats.append(MAT_TRIM)
    for z in (1.25,):
        dists.append(rbox(p - [0, 0.50, z], [1.00, 0.04, 0.24], 0.02)); mats.append(MAT_TRIM)   # garde-boue
    box = rbox(p - [0, 1.28, 0.10], [1.02, 0.60, 2.25], 0.05)
    # rideau arrière : lattes horizontales creusées ; montants d'angle
    for y in np.arange(0.80, 1.85, 0.10):
        box = np.maximum(box, -rbox(p - [0, y, 2.35], [0.86, 0.006, 0.02], 0.002))
    for sx in (-1, 1):
        box = np.maximum(box, -rbox(p - [sx * 0.93, 1.28, 2.35], [0.008, 0.56, 0.02], 0.003))
    dists.append(box); mats.append(MAT_PAINT)
    dists.append(rbox(p - [0, 1.30, 0.10], [1.03, 0.006, 2.26], 0.003)); mats.append(MAT_TRIM)   # cerclage
    dists.append(rbox(p - [0, 0.70, 2.32], [1.02, 0.03, 0.04], 0.01)); mats.append(MAT_CHROME)   # seuil
    dists.append(rbox(p - [0, 1.86, 2.32], [1.02, 0.03, 0.04], 0.01)); mats.append(MAT_TRIM)     # bandeau haut
    for sx in (-1, 1):   # feux d'encombrement
        dists.append(cyl_z(p - [sx * 0.98, 1.84, 2.36], 0.02, 0.025)); mats.append(MAT_LAMP_A)
    cab = rbox(p - [0, 1.24, -2.62], [0.92, 0.56, 0.36], 0.08)
    dists.append(cab); mats.append(MAT_PAINT)
    mirrors(p, dists, mats, 1.04, 1.50, -2.66)
    # l'avant de la cabine : pare-brise haut, façade
    dists.append(rbox(p - [0, 1.46, -2.97], [0.78, 0.28, 0.04], 0.03)); mats.append(MAT_TRIM)
    dists.append(rbox(p - [0, 1.46, -2.98], [0.72, 0.23, 0.05], 0.02)); mats.append(MAT_GLASS)
    front_face(p, dists, mats, 0.92, 0.68, 1.00, -3.00, hw=0.17, hh=0.09, grille=0.34, style='van')
    # feux bas, barre anti-encastrement, plaque
    for sx in (-1, 1):
        dists.append(rbox(p - [sx * 0.78, 0.62, 2.33], [0.16, 0.06, 0.04], 0.015)); mats.append(MAT_LAMP)
        dists.append(rbox(p - [sx * 0.68, 0.62, 2.336], [0.05, 0.04, 0.04], 0.008)); mats.append(MAT_LAMP_W)
        dists.append(rbox(p - [sx * 0.88, 0.62, 2.336], [0.05, 0.04, 0.04], 0.008)); mats.append(MAT_LAMP_A)
    dists.append(rbox(p - [0, 0.38, 2.30], [0.94, 0.05, 0.04], 0.015)); mats.append(MAT_TRIM)
    for sx in (-1, 1):
        dists.append(rbox(p - [sx * 0.60, 0.48, 2.28], [0.03, 0.10, 0.03], 0.01)); mats.append(MAT_TRIM)
    dists.append(rbox(p - [0, 0.66, 2.35], [0.40, 0.11, 0.03], 0.012)); mats.append(MAT_PLATE)
    exhaust(p, dists, mats, -0.55, 0.40, 2.30, 0.045)

KINDS = {'pickup': scene_pickup, 'van': scene_van, 'coupe': scene_coupe,
         'cabrio': scene_cabrio, 'camper': scene_camper, '4x4': scene_4x4,
         'citerne': scene_citerne, 'supercar': scene_supercar,
         'ancienne': scene_ancienne, 'camion': scene_camion}

def scene_car(p, S, dists, mats):
    """Silhouette paramétrée : caisse + cabine, avec ses accessoires optionnels."""
    body = rbox(p - [0, S['body_y'], 0], [S['wid'], S['body_h'], S['len']], S['r_body'])
    wz = (S['wheel_z'], -S['wheel_z'] + 0.1)
    body = arches(body, p, S['wid'], S['wheel_r'], wz)
    roof_p = shear_z(p - [0, S['roof_y'], -0.20], S['glass_tilt'], 0.0)
    roof = rbox(roof_p, [S['roof_wid'], S['roof_h'], S['roof_len']], S['r_roof'])
    shell = smin(body, roof, 0.16)
    shell = bulge(shell, p, S['body_y'] + 0.05, S['len'])
    # joints du hayon / de la malle : deux rainures verticales sur la face arrière
    for sx in (-1, 1):
        shell = np.maximum(shell, -rbox(p - [sx * (S['wid'] - 0.14), S['body_y'] + 0.06, S['len']],
                                        [0.005, S['body_h'] - 0.10, 0.02], 0.002))
    dists.append(shell); mats.append(MAT_PAINT)
    mirrors(p, dists, mats, S['wid'] + 0.09, S['roof_y'] - S['roof_h'] + 0.02, -0.20 - S['roof_len'] + 0.18)

    # lunette : en saillie sur la custode, cerclée d'un joint sombre ; troisième feu stop
    gz = S['roof_len'] - 0.12
    frame_p = shear_z(p - [0, S['roof_y'], gz], S['glass_tilt'], 0.0)
    dists.append(rbox(frame_p, [S['roof_wid'] - 0.03, S['roof_h'] - 0.015, 0.045], 0.03))
    mats.append(MAT_TRIM)
    glass_p = shear_z(p - [0, S['roof_y'], gz + 0.012], S['glass_tilt'], 0.0)
    dists.append(rbox(glass_p, [S['roof_wid'] - 0.09, S['roof_h'] - 0.06, 0.05], 0.02))
    mats.append(MAT_GLASS)
    dists.append(rbox(shear_z(p - [0, S['roof_y'] + S['roof_h'] - 0.05, gz + 0.02], S['glass_tilt'], 0.0),
                      [0.16, 0.012, 0.03], 0.005)); mats.append(MAT_LAMP)
    # l'avant : pare-brise (plus grand que la lunette), joint de capot, façade
    # le pare-brise penche en arrière (sommet vers l'habitacle) : cisaillement inverse de la lunette
    gf = -0.20 - S['roof_len'] + 0.06
    ws_p = shear_z(p - [0, S['roof_y'], gf], -0.55 - S['glass_tilt'], 0.0)
    dists.append(rbox(ws_p, [S['roof_wid'] - 0.01, S['roof_h'] + 0.02, 0.05], 0.03)); mats.append(MAT_TRIM)
    ws_g = shear_z(p - [0, S['roof_y'], gf - 0.015], -0.55 - S['glass_tilt'], 0.0)
    dists.append(rbox(ws_g, [S['roof_wid'] - 0.07, S['roof_h'] - 0.025, 0.05], 0.02)); mats.append(MAT_GLASS)
    dists.append(rbox(p - [0, S['body_y'] + S['body_h'] - 0.02, -S['len'] + 0.02],
                      [S['wid'] - 0.06, 0.012, 0.06], 0.008)); mats.append(MAT_TRIM)
    front_face(p, dists, mats, S['wid'], S['body_y'] - S['body_h'], S['body_y'] + 0.14, -S['len'] - 0.02)
    wipers(p, dists, mats, S['roof_y'] - S['roof_h'] + 0.03, gf - 0.02 + S['glass_tilt'] * (-S['roof_h'] + 0.03), S['roof_wid'], S['glass_tilt'])
    if S.get('spoiler'):   # casquette de hayon
        dists.append(rbox(shear_z(p - [0, S['roof_y'] + S['roof_h'] - 0.02, gz + 0.06], S['glass_tilt'], 0.0),
                          [S['roof_wid'] - 0.02, 0.025, 0.10], 0.02)); mats.append(MAT_PAINT)
    if S.get('rails'):
        for sx in (-1, 1):
            dists.append(rbox(p - [sx * (S['roof_wid'] - 0.10), S['roof_y'] + S['roof_h'] + 0.03, -0.20],
                              [0.025, 0.03, S['roof_len'] - 0.15], 0.015)); mats.append(MAT_TRIM)
    if S.get('antenna'):
        dists.append(rbox(shear_z(p - [0, S['roof_y'] + S['roof_h'] + 0.03, gz - 0.35], 0.0, 0.0),
                          [0.022, 0.035, 0.08], 0.018)); mats.append(MAT_TRIM)

    # rainure de coffre et bas de caisse
    dists.append(rbox(p - [0, S['body_y'] + S['body_h'] - 0.02, S['len'] - 0.02],
                      [S['wid'] - 0.06, 0.012, 0.06], 0.008)); mats.append(MAT_TRIM)
    dists.append(rbox(p - [0, S['body_y'] - S['body_h'] + 0.02, 0],
                      [S['wid'] + 0.005, 0.03, S['len'] - 0.15], 0.02)); mats.append(MAT_TRIM)
    if S.get('lip'):   # baguette chromée de malle
        dists.append(rbox(p - [0, S['body_y'] + S['body_h'] - 0.06, S['len'] + 0.005],
                          [S['wid'] - 0.30, 0.008, 0.012], 0.004)); mats.append(MAT_CHROME)

    wheels(p, dists, mats, S['wheel_r'], S['wid'] - 0.02, wz, 0.13)

    # pare-chocs, feux, emplacement de plaque
    z_back = S['len'] + 0.02
    y_low = S['body_y'] - S['body_h']
    bumper = rbox(p - [0, y_low + 0.075, z_back - 0.035], [S['wid'] + 0.005, 0.105, 0.065], 0.05)
    bumper = diffuser(bumper, p, y_low + 0.03, z_back + 0.03, (-0.22, -0.11, 0.0, 0.11, 0.22), 0.04)
    dists.append(bumper); mats.append(MAT_TRIM)
    if S.get('vlamps'):   # feux verticaux le long du hayon
        for sx in (-1, 1):
            dists.append(rbox(p - [sx * (S['wid'] - 0.09), S['body_y'] + 0.30, z_back - 0.05], [0.07, 0.36, 0.05], 0.03)); mats.append(MAT_LAMP)
            dists.append(rbox(p - [sx * (S['wid'] - 0.09), S['body_y'] + 0.22, z_back - 0.044], [0.05, 0.06, 0.05], 0.012)); mats.append(MAT_LAMP_W)
            dists.append(rbox(p - [sx * (S['wid'] - 0.09), S['body_y'] + 0.02, z_back - 0.044], [0.05, 0.03, 0.05], 0.012)); mats.append(MAT_LAMP_A)
    else:
        for sx in (-1, 1):
            lamp_cluster(p, dists, mats, sx, S['wid'] - 0.26, S['body_y'] + 0.15, z_back - 0.045, 0.24, 0.075)
    # emplacement de plaque, dimensionné pour la plaque lisible posée par le jeu
    dists.append(rbox(p - [0, y_low + 0.20, z_back - 0.055],
                      [0.42, 0.115, 0.03], 0.012)); mats.append(MAT_PLATE)
    exhaust(p, dists, mats, S['wid'] - 0.34, y_low + 0.015, z_back + 0.01, 0.038)

def scene(p, S):
    """Renvoie (distance, identifiant de matériau) pour un nuage de points."""
    dists, mats = [], []
    kind = S.get('kind', 'car')
    if kind != 'car':
        KINDS[kind](p, dists, mats)
    else:
        scene_car(p, S, dists, mats)
    D = np.stack(dists, axis=-1)
    idx = np.argmin(D, axis=-1)
    return (np.take_along_axis(D, idx[..., None], axis=-1)[..., 0],
            np.array(mats, dtype=np.int8)[idx])

def sdf(p, S):
    return scene(p, S)[0]

def normal(p, S):
    e = 0.0010
    k = np.array([[1, -1, -1], [-1, -1, 1], [-1, 1, -1], [1, 1, 1]], dtype=np.float32)
    n = np.zeros(p.shape, dtype=np.float32)
    for kk in k:
        n += kk * sdf(p + e * kk, S)[..., None]
    return n / (np.linalg.norm(n, axis=-1, keepdims=True) + 1e-9)

def march(ro, rd, S, max_steps=MAX_STEPS):
    t = np.zeros(ro.shape[:-1], dtype=np.float32)
    alive = np.ones(t.shape, dtype=bool)
    for _ in range(max_steps):
        if not alive.any():
            break
        p = ro[alive] + rd[alive] * t[alive][..., None]
        d = sdf(p, S)
        t[alive] += d * 0.92          # les sculptures de pneu ne sont pas 1-Lipschitz : on avance prudemment
        still = (d > EPS) & (t[alive] < MAX_DIST)
        idx = np.where(alive)[0]
        alive[idx[~still]] = False
    hit = t < MAX_DIST
    return t, hit

def soft_shadow(ro, rd, S, k=12.0):
    """Ombre douce : on suit le rayon vers la lumière en gardant la marge minimale."""
    res = np.ones(ro.shape[:-1], dtype=np.float32)
    t = np.full(ro.shape[:-1], 0.03, dtype=np.float32)
    alive = np.ones(t.shape, dtype=bool)
    for _ in range(32):
        if not alive.any():
            break
        p = ro[alive] + rd[alive] * t[alive][..., None]
        d = sdf(p, S)
        res[alive] = np.minimum(res[alive], k * d / np.maximum(t[alive], 1e-4))
        t[alive] += np.clip(d, 0.012, 0.35)
        still = (d > 0.002) & (t[alive] < 6.0)
        idx = np.where(alive)[0]
        alive[idx[~still]] = False
    return np.clip(res, 0.0, 1.0)

def ao(p, n, S):
    occ, w = np.zeros(p.shape[:-1], dtype=np.float32), 1.0
    for i in range(1, 7):
        h = 0.03 * i
        occ += (h - sdf(p + n * h, S)) * w
        w *= 0.68
    return np.clip(1.0 - 2.0 * occ, 0.0, 1.0)

# ─────────────── éclairage ───────────────
SUN_DIR   = np.array([0.42, 0.62, 0.66], dtype=np.float32)      # haut-arrière droit : éclaire la face vue
SUN_DIR  /= np.linalg.norm(SUN_DIR)
RIM_DIR   = np.array([-0.35, 0.28, -0.90], dtype=np.float32)    # contre-jour du couchant
RIM_DIR  /= np.linalg.norm(RIM_DIR)
SUN_COL   = np.array([1.00, 0.90, 0.76], dtype=np.float32) * 1.9
SKY_TOP   = np.array([0.20, 0.36, 0.72], dtype=np.float32)
HORIZON   = np.array([1.00, 0.66, 0.42], dtype=np.float32)   # halo du couchant
SKY_LOW   = np.array([0.96, 0.86, 0.72], dtype=np.float32)   # ciel pâle près de l'horizon
GROUND    = np.array([0.13, 0.11, 0.09], dtype=np.float32)
SKY_A     = np.array([0.34, 0.44, 0.66], dtype=np.float32) * 0.42   # irradiance du ciel
GND_A     = np.array([0.18, 0.15, 0.12], dtype=np.float32) * 0.30   # irradiance du sol
RIM_COL   = np.array([1.00, 0.58, 0.30], dtype=np.float32) * 2.2

def env(rd):
    """Environnement procédural : ciel dégradé, soleil, ligne d'horizon nette,
    deux bandes lumineuses « studio » qui dessinent le galbe du vernis, sol sombre."""
    y = rd[..., 1]
    t = np.clip(y, 0, 1)[..., None]
    sky = SKY_LOW * (1 - t) ** 3.0 + SKY_TOP * (1 - (1 - t) ** 3.0)
    band = lambda c, w: np.exp(-((y - c) / w) ** 2)[..., None]
    sky = sky + np.array([1.0, 0.96, 0.90], dtype=np.float32) * (0.9 * band(0.22, 0.045) + 0.55 * band(0.58, 0.07))
    sd = np.clip((rd * SUN_DIR).sum(-1), 0, 1)
    sun = (np.where(sd > 0.9990, 1.0, 0.0) * 4.0 + sd ** 80 * 1.2 + sd ** 6 * 0.12)[..., None] * SUN_COL
    ground = GROUND * (0.6 + 1.6 * np.exp(np.minimum(y, 0) * 12))[..., None]
    col = np.where(y[..., None] >= 0, sky, ground)
    col = col + HORIZON * 0.30 * np.where(y >= 0, np.exp(-y * 10), np.exp(y * 40) * 0.5)[..., None]
    return col + sun

def ggx(n, v, l, rough):
    h = l + v
    h /= (np.linalg.norm(h, axis=-1, keepdims=True) + 1e-9)
    ndh = np.clip((n * h).sum(-1), 0, 1)
    ndv = np.clip((n * v).sum(-1), 0, 1)
    ndl = np.clip((n * l).sum(-1), 0, 1)
    a = np.maximum(rough * rough, 1e-3)
    d = a * a / (math.pi * ((ndh * ndh * (a * a - 1) + 1) ** 2) + 1e-9)
    k = (rough + 1) ** 2 / 8.0
    g = (ndl / (ndl * (1 - k) + k + 1e-9)) * (ndv / (ndv * (1 - k) + k + 1e-9))
    f = 0.05 + 0.95 * (1 - ndv) ** 5
    return d * g * f * ndl

def aces(x):
    a, b, c, d, e = 2.51, 0.03, 2.43, 0.59, 0.14
    return np.clip((x * (a * x + b)) / (x * (c * x + d) + e), 0.0, 1.0)

CAM = np.array([0.0, 1.55, 6.60], dtype=np.float32)
TGT = np.array([0.0, 0.85, 0.05], dtype=np.float32)
FOCAL = 4.3

def camera():
    cam, tgt = CAM, TGT
    if VIEW == 'front':                          # devant la voiture, symétrique de la vue arrière,
        cam = CAM * np.array([1, 1, -1], dtype=np.float32)   # mais un peu plus haut : le pare-brise se dégage
        tgt = TGT * np.array([1, 1, -1], dtype=np.float32)
        cam = cam + np.array([0, 0.10, 0], dtype=np.float32)
    fwd = tgt - cam; fwd /= np.linalg.norm(fwd)
    rgt = np.cross(fwd, [0, 1, 0]); rgt /= np.linalg.norm(rgt)
    up = np.cross(rgt, fwd)
    return fwd, rgt, up, cam

# ─────────────── rendu d'une silhouette ───────────────
def render(name, S):
    fwd, rgt, up, cam = camera()
    xs = (np.arange(RW, dtype=np.float32) + 0.5) / RW * 2 - 1
    ys = 1 - (np.arange(RH, dtype=np.float32) + 0.5) / RH * 2
    gx, gy = np.meshgrid(xs, ys)
    gx *= RW / RH
    rd = (fwd + (gx[..., None] * rgt + gy[..., None] * up) / FOCAL).astype(np.float32)
    rd /= np.linalg.norm(rd, axis=-1, keepdims=True)
    rd = rd.reshape(-1, 3)
    ro = np.broadcast_to(cam, rd.shape).copy()

    # sphère englobante : on n'envoie de rayons que là où il peut y avoir de la matière
    oc = ro - np.array([0, 0.95, 0], dtype=np.float32)
    b = (oc * rd).sum(-1)
    c = (oc * oc).sum(-1) - 4.2 ** 2
    pre = (b * b - c) > 0

    t = np.full(rd.shape[0], MAX_DIST + 1, dtype=np.float32)
    hit = np.zeros(rd.shape[0], dtype=bool)
    tt, hh = march(ro[pre], rd[pre], S)
    t[pre], hit[pre] = tt, hh

    idx = np.where(hit)[0]
    p = ro[idx] + rd[idx] * t[idx][..., None]
    n = normal(p, S)
    v = -rd[idx]
    mat = scene(p, S)[1]

    ndl = np.clip((n * SUN_DIR).sum(-1), 0, 1)
    ndv = np.clip((n * v).sum(-1), 0, 1)
    sh = soft_shadow(p + n * 0.012, np.broadcast_to(SUN_DIR, p.shape).copy(), S)
    occ = ao(p, n, S)
    occ *= np.clip(p[..., 1] / 0.30, 0.45, 1.0)          # les dessous restent dans l'ombre
    hemi = 0.5 + 0.5 * n[..., 1]
    rim = np.clip((n * RIM_DIR).sum(-1), 0, 1) ** 2.2

    ambient = (SKY_A * hemi[..., None] + GND_A * (1 - hemi)[..., None]) * occ[..., None]
    diffuse = SUN_COL * (ndl * sh)[..., None] + ambient + RIM_COL * (rim * occ)[..., None] * 0.45

    # reflets : vecteur réfléchi → environnement, flouté selon la rugosité, pondéré par Fresnel
    r = rd[idx] - 2.0 * (n * rd[idx]).sum(-1, keepdims=True) * n
    env_sharp = env(r)
    hemi_r = 0.5 + 0.5 * r[..., 1]
    env_blur = (SKY_A * hemi_r[..., None] + GND_A * (1 - hemi_r)[..., None]) * 3.2 + HORIZON * 0.12
    def refl(rough):
        k = np.clip(rough * 1.7, 0, 1)
        return env_sharp * (1 - k) + env_blur * k
    def fres(f0):
        return f0 + (1 - f0) * (1 - ndv) ** 5
    def spec_sun(rough):
        return SUN_COL * (ggx(n, v, np.broadcast_to(SUN_DIR, p.shape), rough) * sh * occ)[..., None]
    occ3 = occ[..., None]

    # peinture : diffus (× teinte), vernis (indépendant de la teinte), reflet métallique (× teinte)
    coat = refl(0.07) * fres(0.04)[..., None] * occ3 * 0.85 + spec_sun(0.09) * 0.8 + spec_sun(0.32) * 0.3
    metal = refl(0.14) * occ3 * 0.95 + spec_sun(0.22) * 1.1 + refl(0.5) * 0.10 * occ3

    # rayures des réflecteurs de feux
    ribs = (0.72 + 0.28 * np.cos(p[..., 1] * 260.0))
    glow = ribs * (0.85 + 0.15 * ndv)

    def shade(base, rough, f0, emis=None, metallic=False):
        base = np.asarray(base, dtype=np.float32)
        if metallic:
            col = base * (refl(rough) * occ3 + spec_sun(rough) * 1.2) + base * ambient * 0.3
        else:
            col = base * diffuse + refl(rough) * fres(f0)[..., None] * occ3 + spec_sun(rough)
        if emis is not None:
            col = col + np.asarray(emis, dtype=np.float32) * glow[..., None]
        return col

    other = np.zeros((len(idx), 3), dtype=np.float32)
    table = {
        MAT_GLASS:  shade([0.010, 0.013, 0.018], 0.04, 0.09),
        MAT_TYRE:   shade([0.011, 0.011, 0.012], 0.80, 0.03),
        MAT_RIM:    shade([0.62, 0.63, 0.66], 0.32, 0.9, metallic=True),
        MAT_CHROME: shade([0.92, 0.93, 0.95], 0.08, 0.9, metallic=True),
        MAT_LAMP:   shade([0.42, 0.018, 0.012], 0.06, 0.05, emis=np.array([0.95, 0.06, 0.03]) * 0.34),
        MAT_LAMP_W: shade([0.50, 0.50, 0.52], 0.06, 0.05, emis=np.array([0.9, 0.9, 0.92]) * 0.05),
        MAT_LAMP_A: shade([0.70, 0.30, 0.03], 0.06, 0.05, emis=np.array([0.95, 0.45, 0.05]) * 0.22),
        MAT_HEAD:   shade([0.80, 0.82, 0.86], 0.05, 0.06, emis=np.array([1.0, 0.96, 0.80]) * 0.9),   # phares allumés
        MAT_TRIM:   shade([0.016, 0.017, 0.019], 0.55, 0.04),
        MAT_PLATE:  shade([0.020, 0.020, 0.022], 0.85, 0.03),
        MAT_CANVAS: shade([0.030, 0.026, 0.022], 0.95, 0.02),
    }
    for m, col in table.items():
        sel = mat == m
        other[sel] = col[sel]

    is_paint = (mat == MAT_PAINT)
    return dict(shape=(RH, RW), idx=idx, is_paint=is_paint,
                diffuse=diffuse, coat=coat, metal=metal, other=other)

def compose(buf, paint, crop=None, out_w=None):
    """Applique une couleur de carrosserie aux tampons d'éclairage déjà calculés."""
    RHh, RWw = buf['shape']
    img = np.zeros((RHh * RWw, 3), dtype=np.float32)
    alpha = np.zeros(RHh * RWw, dtype=np.float32)
    col = np.asarray(paint['rgb'], dtype=np.float32)
    m = paint.get('metal', 0.0)
    lit_paint = (col * buf['diffuse'] * (1 - m) + buf['coat'] * (1 - 0.55 * m)
                 + col * buf['metal'] * m)
    px = np.where(buf['is_paint'][..., None], lit_paint, buf['other'])
    img[buf['idx']] = px
    alpha[buf['idx']] = 1.0
    rgb = aces(img).reshape(RHh, RWw, 3) ** (1 / 2.2)
    a = alpha.reshape(RHh, RWw)
    out = np.concatenate([rgb, a[..., None]], axis=-1)
    im = Image.fromarray((np.clip(out, 0, 1) * 255).astype(np.uint8), 'RGBA')
    if crop:
        im = im.crop(crop)
    if out_w:
        im = im.resize((out_w, max(1, round(im.height * out_w / im.width))), Image.LANCZOS)
    return im

def plate_box(S):
    """Projette l'emplacement de plaque à l'écran : le jeu y pose sa plaque HTML."""
    fwd, rgt, up, cam = camera(); aspect = RW / RH
    if VIEW == 'front' and 'front_plate' in S:
        cy, z, hw, hh = S['front_plate']
    elif VIEW == 'front':
        y_low = S['body_y'] - S['body_h']
        cy, hw, hh = y_low + 0.20, 0.42, 0.115
        z = -S['len'] - 0.02 - 0.045 - 0.03
    elif 'plate' in S:
        cy, z, hw, hh = S['plate']
    else:
        y_low = S['body_y'] - S['body_h']
        cy, hw, hh = y_low + 0.20, 0.42, 0.115
        z = S['len'] + 0.02 - 0.055 + 0.03
    pts = [(-hw, cy - hh), (hw, cy - hh), (-hw, cy + hh), (hw, cy + hh)]
    xs, ys = [], []
    for x, y in pts:
        d = np.array([x, y, z]) - cam
        cx_, cy_, cz_ = d @ rgt, d @ up, d @ fwd
        gx = (cx_ / cz_) * FOCAL / aspect
        gy = (cy_ / cz_) * FOCAL
        xs.append((gx + 1) / 2); ys.append((1 - gy) / 2)
    return dict(x=min(xs), y=min(ys), w=max(xs) - min(xs), h=max(ys) - min(ys))

COLORS = {
  'rouge':  dict(rgb=(0.52, 0.035, 0.028)),
  'bleu':   dict(rgb=(0.035, 0.13, 0.52)),
  'blanc':  dict(rgb=(0.88, 0.89, 0.90)),
  'noir':   dict(rgb=(0.022, 0.025, 0.032)),
  'vert':   dict(rgb=(0.035, 0.27, 0.14)),
  'jaune':  dict(rgb=(0.76, 0.52, 0.030)),
  'gris':   dict(rgb=(0.27, 0.29, 0.33), metal=0.35),
  'orange': dict(rgb=(0.75, 0.22, 0.026)),
  'violet': dict(rgb=(0.30, 0.09, 0.54), metal=0.25),
  'chrome': dict(rgb=(0.86, 0.88, 0.92), metal=0.95),
  'nacre':  dict(rgb=(0.92, 0.82, 0.88), metal=0.30),
  'or':     dict(rgb=(0.85, 0.52, 0.06), metal=0.90),
  'bronze': dict(rgb=(0.55, 0.24, 0.08), metal=0.85),
  'argent': dict(rgb=(0.80, 0.82, 0.86), metal=0.85),
}

if __name__ == '__main__':
    os.makedirs(OUT, exist_ok=True)
    import time, json
    layout = {}
    if len(sys.argv) > 4 and sys.argv[4] == 'front':
        VIEW = 'front'
        SUN_DIR = SUN_DIR * np.array([-1, 1, -1], dtype=np.float32)   # le couchant est devant vous : il éclaire la face avant
        RIM_DIR = RIM_DIR * np.array([-1, 1, -1], dtype=np.float32)
    suffix = '-front' if VIEW == 'front' else ''
    only = sys.argv[2].split(',') if len(sys.argv) > 2 else None
    if only:
        SHAPES = {k: v for k, v in SHAPES.items() if k in only}
        COLORS = {k: v for k, v in COLORS.items() if k in (sys.argv[3].split(',') if len(sys.argv) > 3 else COLORS)}
    for name, S in SHAPES.items():
        t0 = time.time()
        buf = render(name, S)
        print('%-9s géométrie rendue en %5.1f s' % (name, time.time() - t0), flush=True)

        # recadrage au plus juste : le sprite ne transporte pas de vide
        ref = compose(buf, dict(rgb=(0.5, 0.5, 0.5)))
        bb = ref.getbbox()
        pad = 3
        crop = (max(0, bb[0] - pad), max(0, bb[1] - pad),
                min(ref.width, bb[2] + pad), min(ref.height, bb[3] + pad))
        cw, ch = crop[2] - crop[0], crop[3] - crop[1]

        pb = plate_box(S)                       # fractions de l'image PLEINE
        layout[name + suffix] = dict(
            x=(pb['x'] * ref.width - crop[0]) / cw,
            y=(pb['y'] * ref.height - crop[1]) / ch,
            w=pb['w'] * ref.width / cw,
            h=pb['h'] * ref.height / ch,
            ratio=round(cw / ch, 4))

        for cname, paint in COLORS.items():
            im = compose(buf, paint, crop=crop, out_w=OUT_W)
            path = os.path.join(OUT, '%s-%s%s.webp' % (name, cname, suffix))
            im.save(path, 'WEBP', quality=86, method=6)
            print('   %-28s %5.1f Ko' % (os.path.basename(path), os.path.getsize(path) / 1024), flush=True)
    # layout.json se complète à chaque rendu : les silhouettes non rendues gardent leur entrée
    lp = os.path.join(OUT, 'layout.json')
    prev = json.load(open(lp)) if os.path.exists(lp) else {}
    merged = prev.get('plate', {})
    merged.update(layout)
    with open(lp, 'w') as f:
        json.dump({'sprite': {'w': W, 'h': H}, 'plate': merged}, f, indent=1)
    for k, v in layout.items():
        print('plaque %-9s centre x=%.3f y=%.3f · largeur %.3f · sprite %.2f:1'
              % (k, v['x'] + v['w'] / 2, v['y'] + v['h'] / 2, v['w'], v['ratio']))
    print('RENDU_TERMINE')

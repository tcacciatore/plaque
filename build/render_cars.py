# -*- coding: utf-8 -*-
"""Rendu des sprites de voitures du mode Trafic.

Ray marching sur des surfaces implicites (SDF), vectorisé avec numpy.
Aucune dépendance à un moteur 3D ni à un modèle sous licence : les
carrosseries sont génériques et décrites ici.

La géométrie n'est rendue qu'UNE fois par silhouette ; les variantes de
couleur sont composées ensuite depuis les tampons d'éclairage (diffus,
spéculaire, masque de peinture), ce qui évite de relancer le rendu.

    python3 build/render_cars.py assets/cars
"""
import sys, os, math
import numpy as np
from PIL import Image

OUT = sys.argv[1] if len(sys.argv) > 1 else 'assets/cars'
W, H = 560, 380          # cadre de rendu
OUT_W = 520              # largeur du sprite livré, après recadrage
SS = 2                   # supersampling (rendu à SS×, réduit ensuite)
RW, RH = W * SS, H * SS
MAX_STEPS, MAX_DIST, EPS = 96, 40.0, 0.0016

# ─────────────── primitives ───────────────
def rbox(p, b, r):
    """Boîte arrondie : p (…,3), b demi-dimensions, r rayon."""
    q = np.abs(p) - np.asarray(b) + r
    return (np.linalg.norm(np.maximum(q, 0.0), axis=-1)
            + np.minimum(np.max(q, axis=-1), 0.0) - r)

def cyl_x(p, half_len, radius):
    """Cylindre d'axe X."""
    d_axial = np.abs(p[..., 0]) - half_len
    d_radial = np.linalg.norm(p[..., 1:3], axis=-1) - radius
    return (np.minimum(np.maximum(d_axial, d_radial), 0.0)
            + np.linalg.norm(np.stack([np.maximum(d_axial, 0), np.maximum(d_radial, 0)], -1), axis=-1))

def cyl_z(p, half_len, radius):
    d_axial = np.abs(p[..., 2]) - half_len
    d_radial = np.linalg.norm(p[..., 0:2], axis=-1) - radius
    return (np.minimum(np.maximum(d_axial, d_radial), 0.0)
            + np.linalg.norm(np.stack([np.maximum(d_axial, 0), np.maximum(d_radial, 0)], -1), axis=-1))

def smin(a, b, k):
    """Union lissée : raccorde la caisse et la cabine sans arête."""
    h = np.clip(0.5 + 0.5 * (b - a) / k, 0.0, 1.0)
    return b * (1 - h) + a * h - k * h * (1 - h)

def shear_z(p, amount, pivot_y):
    """Incline une primitive autour de l'axe X (custode fuyante)."""
    q = p.copy()
    q[..., 2] = q[..., 2] + amount * (q[..., 1] - pivot_y)
    return q

# ─────────────── silhouettes ───────────────
SHAPES = {
  'berline':  dict(len=2.05, wid=0.89, body_y=0.68, body_h=0.36, roof_y=1.13, roof_h=0.25,
                   roof_len=1.05, roof_wid=0.74, wheel_r=0.33, wheel_z=1.42, glass_tilt=0.40,
                   r_body=0.10, r_roof=0.09),
  'suv':      dict(len=2.10, wid=0.93, body_y=0.80, body_h=0.44, roof_y=1.38, roof_h=0.29,
                   roof_len=1.28, roof_wid=0.80, wheel_r=0.40, wheel_z=1.45, glass_tilt=0.16,
                   r_body=0.09, r_roof=0.08),
  'citadine': dict(len=1.78, wid=0.85, body_y=0.68, body_h=0.34, roof_y=1.14, roof_h=0.28,
                   roof_len=0.90, roof_wid=0.72, wheel_r=0.31, wheel_z=1.20, glass_tilt=0.26,
                   r_body=0.10, r_roof=0.09),
}

MAT_PAINT, MAT_GLASS, MAT_TYRE, MAT_RIM, MAT_LAMP, MAT_TRIM, MAT_PLATE = 1, 2, 3, 4, 5, 6, 7

# plaque : (centre y, z, demi-largeur, demi-hauteur) — pour la projection de layout.json
SHAPES['pickup'] = dict(kind='pickup', plate=(0.78, 2.20, 0.40, 0.11))
SHAPES['van']    = dict(kind='van',    plate=(0.72, 2.22, 0.40, 0.11))
SHAPES['coupe']  = dict(kind='coupe',  plate=(0.60, 2.14, 0.40, 0.11))
SHAPES['cabrio'] = dict(kind='cabrio', plate=(0.56, 2.08, 0.40, 0.11))
SHAPES['camper'] = dict(kind='camper', plate=(0.70, 2.43, 0.40, 0.11))
SHAPES['4x4']    = dict(kind='4x4',    plate=(0.66, 2.02, 0.40, 0.11))
SHAPES['citerne'] = dict(kind='citerne', plate=(0.62, 2.36, 0.40, 0.11))

def wheels(p, dists, mats, r, x, zs, half=0.13):
    for z in zs:
        for sx in (-1, 1):
            c = [sx * x, r, z]
            dists.append(cyl_x(p - c, half, r)); mats.append(MAT_TYRE)
            dists.append(cyl_x(p - c, half + 0.01, r * 0.55)); mats.append(MAT_RIM)

def scene_pickup(p, dists, mats):
    wheels(p, dists, mats, 0.38, 0.86, (1.50, -1.40), 0.15)
    chassis = rbox(p - [0, 0.62, 0], [0.92, 0.24, 2.28], 0.08)
    cab = rbox(p - [0, 1.24, -0.95], [0.86, 0.38, 0.72], 0.10)
    dists.append(smin(chassis, cab, 0.10)); mats.append(MAT_PAINT)
    # benne ouverte : une boîte évidée
    outer = rbox(p - [0, 0.96, 0.85], [0.92, 0.30, 1.36], 0.05)
    inner = rbox(p - [0, 1.06, 0.85], [0.80, 0.30, 1.24], 0.03)
    dists.append(np.maximum(outer, -inner)); mats.append(MAT_PAINT)
    dists.append(rbox(p - [0, 0.80, 0.85], [0.80, 0.02, 1.24], 0.01)); mats.append(MAT_TRIM)   # plancher
    # lunette de cabine + joint
    dists.append(rbox(p - [0, 1.30, -0.21], [0.72, 0.26, 0.04], 0.03)); mats.append(MAT_TRIM)
    dists.append(rbox(p - [0, 1.30, -0.20], [0.64, 0.20, 0.05], 0.02)); mats.append(MAT_GLASS)
    # feux verticaux aux coins de la benne, pare-chocs, plaque, échappement
    for sx in (-1, 1):
        dists.append(rbox(p - [sx * 0.84, 0.97, 2.19], [0.06, 0.22, 0.04], 0.02)); mats.append(MAT_LAMP)
    dists.append(rbox(p - [0, 0.42, 2.22], [0.96, 0.09, 0.07], 0.04)); mats.append(MAT_TRIM)
    dists.append(rbox(p - [0, 0.78, 2.21], [0.40, 0.11, 0.03], 0.012)); mats.append(MAT_PLATE)
    dists.append(cyl_z(p - [0.62, 0.36, 2.25], 0.06, 0.04)); mats.append(MAT_TRIM)

def scene_van(p, dists, mats):
    wheels(p, dists, mats, 0.34, 0.84, (1.40, -1.45), 0.13)
    body = rbox(p - [0, 1.14, 0], [0.90, 0.78, 2.22], 0.12)
    dists.append(body); mats.append(MAT_PAINT)
    # portes arrière : deux vitres verticales, un joint central, un bas de porte
    for sx in (-1, 1):
        dists.append(rbox(p - [sx * 0.43, 1.44, 2.21], [0.36, 0.31, 0.04], 0.03)); mats.append(MAT_TRIM)
        dists.append(rbox(p - [sx * 0.43, 1.44, 2.22], [0.31, 0.26, 0.05], 0.02)); mats.append(MAT_GLASS)
    dists.append(rbox(p - [0, 1.10, 2.23], [0.012, 0.74, 0.02], 0.005)); mats.append(MAT_TRIM)
    dists.append(rbox(p - [0, 0.98, 2.225], [0.86, 0.008, 0.02], 0.004)); mats.append(MAT_TRIM)
    for sx in (-1, 1):
        dists.append(rbox(p - [sx * 0.85, 1.02, 2.20], [0.05, 0.30, 0.04], 0.02)); mats.append(MAT_LAMP)
    dists.append(rbox(p - [0, 0.42, 2.24], [0.93, 0.10, 0.07], 0.045)); mats.append(MAT_TRIM)
    dists.append(rbox(p - [0, 0.72, 2.23], [0.40, 0.11, 0.03], 0.012)); mats.append(MAT_PLATE)
    dists.append(cyl_z(p - [-0.60, 0.34, 2.27], 0.06, 0.035)); mats.append(MAT_TRIM)

def scene_coupe(p, dists, mats):
    wheels(p, dists, mats, 0.34, 0.90, (1.42, -1.38), 0.17)
    body = rbox(p - [0, 0.62, 0], [0.95, 0.24, 2.12], 0.14)
    roof = rbox(shear_z(p - [0, 1.00, -0.30], 0.95, 0.0), [0.78, 0.17, 0.95], 0.12)
    dists.append(smin(body, roof, 0.26)); mats.append(MAT_PAINT)
    # lunette très couchée
    dists.append(rbox(shear_z(p - [0, 1.00, 0.48], 0.95, 0.0), [0.68, 0.135, 0.04], 0.03)); mats.append(MAT_TRIM)
    dists.append(rbox(shear_z(p - [0, 1.00, 0.49], 0.95, 0.0), [0.62, 0.10, 0.05], 0.02)); mats.append(MAT_GLASS)
    # becquet sur ses supports
    dists.append(rbox(p - [0, 0.98, 1.92], [0.80, 0.022, 0.13], 0.02)); mats.append(MAT_PAINT)
    for sx in (-1, 1):
        dists.append(rbox(p - [sx * 0.62, 0.90, 1.94], [0.05, 0.07, 0.06], 0.01)); mats.append(MAT_TRIM)
    # bandeau de feux sur toute la largeur, diffuseur, double sortie
    dists.append(rbox(p - [0, 0.76, 2.11], [0.88, 0.035, 0.04], 0.02)); mats.append(MAT_LAMP)
    dists.append(rbox(p - [0, 0.43, 2.15], [0.96, 0.09, 0.07], 0.05)); mats.append(MAT_TRIM)
    for sx in (-1, 1):
        dists.append(cyl_z(p - [sx * 0.55, 0.40, 2.20], 0.07, 0.05)); mats.append(MAT_RIM)
    dists.append(rbox(p - [0, 0.60, 2.13], [0.40, 0.11, 0.03], 0.012)); mats.append(MAT_PLATE)

def scene_cabrio(p, dists, mats):
    wheels(p, dists, mats, 0.33, 0.88, (1.35, -1.32), 0.14)
    body = rbox(p - [0, 0.60, 0], [0.92, 0.24, 2.05], 0.14)
    dists.append(body); mats.append(MAT_PAINT)
    # capote repliée derrière les sièges, dossiers et appuie-têtes visibles par-dessus la caisse
    dists.append(rbox(p - [0, 0.90, 0.95], [0.80, 0.07, 0.30], 0.05)); mats.append(MAT_TRIM)
    for sx in (-1, 1):
        dists.append(rbox(p - [sx * 0.40, 0.92, 0.30], [0.22, 0.14, 0.08], 0.04)); mats.append(MAT_TRIM)
        dists.append(rbox(p - [sx * 0.40, 1.12, 0.26], [0.13, 0.08, 0.06], 0.04)); mats.append(MAT_TRIM)
    # pare-brise, incliné vers l'avant, vu à travers l'habitacle
    dists.append(rbox(shear_z(p - [0, 1.10, -0.75], -0.55, 0.0), [0.76, 0.24, 0.03], 0.025)); mats.append(MAT_TRIM)
    dists.append(rbox(shear_z(p - [0, 1.10, -0.74], -0.55, 0.0), [0.70, 0.20, 0.035], 0.02)); mats.append(MAT_GLASS)
    for sx in (-1, 1):
        dists.append(rbox(p - [sx * 0.60, 0.72, 2.06], [0.25, 0.07, 0.04], 0.03)); mats.append(MAT_LAMP)
    dists.append(rbox(p - [0, 0.43, 2.09], [0.95, 0.09, 0.07], 0.05)); mats.append(MAT_TRIM)
    for sx in (-1, 1):
        dists.append(cyl_z(p - [sx * 0.55, 0.40, 2.14], 0.07, 0.045)); mats.append(MAT_RIM)
    dists.append(rbox(p - [0, 0.56, 2.07], [0.40, 0.11, 0.03], 0.012)); mats.append(MAT_PLATE)

def scene_camper(p, dists, mats):
    wheels(p, dists, mats, 0.36, 0.92, (1.50, -1.45), 0.13)
    cell = rbox(p - [0, 1.10, 0.20], [1.02, 0.74, 2.22], 0.10)
    dists.append(cell); mats.append(MAT_PAINT)
    # fenêtre haute, bande décorative, porte arrière, échelle à droite
    dists.append(rbox(p - [0.10, 1.52, 2.41], [0.34, 0.22, 0.04], 0.03)); mats.append(MAT_TRIM)
    dists.append(rbox(p - [0.10, 1.52, 2.42], [0.29, 0.17, 0.05], 0.02)); mats.append(MAT_GLASS)
    dists.append(rbox(p - [0, 1.02, 2.415], [1.0, 0.03, 0.012], 0.006)); mats.append(MAT_TRIM)
    dists.append(rbox(p - [-0.52, 1.10, 2.415], [0.008, 0.58, 0.015], 0.004)); mats.append(MAT_TRIM)
    for i in range(5):
        dists.append(rbox(p - [0.78, 0.62 + i * 0.27, 2.44], [0.13, 0.018, 0.02], 0.01)); mats.append(MAT_RIM)
    for sx in (-1, 1):
        dists.append(rbox(p - [0.78 + sx * 0.13, 1.18, 2.44], [0.018, 0.62, 0.02], 0.01)); mats.append(MAT_RIM)
    for sx in (-1, 1):
        dists.append(rbox(p - [sx * 0.94, 0.86, 2.39], [0.06, 0.19, 0.04], 0.02)); mats.append(MAT_LAMP)
    dists.append(rbox(p - [0, 0.42, 2.43], [1.03, 0.10, 0.07], 0.045)); mats.append(MAT_TRIM)
    dists.append(rbox(p - [0, 0.70, 2.425], [0.40, 0.11, 0.03], 0.012)); mats.append(MAT_PLATE)

def scene_4x4(p, dists, mats):
    wheels(p, dists, mats, 0.42, 0.90, (1.35, -1.32), 0.18)
    body = rbox(p - [0, 0.95, 0], [0.90, 0.40, 1.95], 0.07)
    cab = rbox(p - [0, 1.55, -0.10], [0.84, 0.28, 1.35], 0.06)
    dists.append(smin(body, cab, 0.05)); mats.append(MAT_PAINT)
    # lunette, roue de secours sur la porte, galerie de toit
    dists.append(rbox(p - [0, 1.66, 1.24], [0.66, 0.19, 0.04], 0.03)); mats.append(MAT_TRIM)
    dists.append(rbox(p - [0, 1.66, 1.25], [0.60, 0.15, 0.05], 0.02)); mats.append(MAT_GLASS)
    dists.append(cyl_z(p - [0, 1.12, 2.04], 0.12, 0.33)); mats.append(MAT_TYRE)
    dists.append(cyl_z(p - [0, 1.12, 2.16], 0.02, 0.19)); mats.append(MAT_RIM)
    for sx in (-1, 1):
        dists.append(rbox(p - [sx * 0.62, 1.88, -0.10], [0.03, 0.03, 1.15], 0.015)); mats.append(MAT_TRIM)
    dists.append(rbox(p - [0, 1.88, 1.02], [0.64, 0.03, 0.03], 0.015)); mats.append(MAT_TRIM)
    for sx in (-1, 1):
        dists.append(rbox(p - [sx * 0.86, 1.02, 1.97], [0.06, 0.20, 0.04], 0.02)); mats.append(MAT_LAMP)
    dists.append(rbox(p - [0, 0.48, 2.00], [0.97, 0.12, 0.10], 0.05)); mats.append(MAT_TRIM)
    dists.append(rbox(p - [0, 0.66, 2.01], [0.40, 0.11, 0.03], 0.012)); mats.append(MAT_PLATE)

def scene_citerne(p, dists, mats):
    # deux essieux arrière jumelés, châssis, cuve cylindrique, cabine devant
    wheels(p, dists, mats, 0.40, 0.86, (1.55, 0.75, -1.55), 0.16)
    dists.append(rbox(p - [0, 0.62, 0], [0.92, 0.12, 2.30], 0.04)); mats.append(MAT_TRIM)
    tank = cyl_z(p - [0, 1.22, 0.30], 1.85, 0.60)
    dists.append(tank); mats.append(MAT_PAINT)
    dists.append(cyl_z(p - [0, 1.22, 0.30], 1.88, 0.55)); mats.append(MAT_PAINT)   # fonds bombés
    for z in (-0.9, 0.3, 1.5):                                                     # cerclages
        dists.append(cyl_z(p - [0, 1.22, z], 0.05, 0.625)); mats.append(MAT_RIM)
    cab = rbox(p - [0, 1.18, -2.55], [0.86, 0.58, 0.40], 0.08)
    dists.append(cab); mats.append(MAT_PAINT)
    # échelle à gauche, passerelle, feux, pare-chocs, plaque
    for i in range(5):
        dists.append(rbox(p - [-0.70, 0.66 + i * 0.26, 2.20], [0.11, 0.016, 0.02], 0.008)); mats.append(MAT_RIM)
    for sx in (-1, 1):
        dists.append(rbox(p - [-0.70 + sx * 0.11, 1.18, 2.20], [0.016, 0.60, 0.02], 0.008)); mats.append(MAT_RIM)
    dists.append(rbox(p - [0, 1.85, 0.30], [0.30, 0.015, 1.7], 0.008)); mats.append(MAT_TRIM)
    for sx in (-1, 1):
        dists.append(rbox(p - [sx * 0.80, 0.72, 2.31], [0.10, 0.14, 0.04], 0.02)); mats.append(MAT_LAMP)
    dists.append(rbox(p - [0, 0.44, 2.34], [0.95, 0.09, 0.07], 0.04)); mats.append(MAT_TRIM)
    dists.append(rbox(p - [0, 0.62, 2.35], [0.40, 0.11, 0.03], 0.012)); mats.append(MAT_PLATE)
    # marquage danger : plaque orange sous la cuve
    dists.append(rbox(p - [0, 0.92, 2.33], [0.20, 0.07, 0.02], 0.01)); mats.append(MAT_LAMP)

def scene(p, S):
    """Renvoie (distance, identifiant de matériau) pour un nuage de points."""
    dists, mats = [], []
    kind = S.get('kind', 'car')
    if kind != 'car':
        {'pickup': scene_pickup, 'van': scene_van, 'coupe': scene_coupe,
         'cabrio': scene_cabrio, 'camper': scene_camper, '4x4': scene_4x4,
         'citerne': scene_citerne}[kind](p, dists, mats)
        D = np.stack(dists, axis=-1)
        idx = np.argmin(D, axis=-1)
        return (np.take_along_axis(D, idx[..., None], axis=-1)[..., 0],
                np.array(mats, dtype=np.int8)[idx])

    body = rbox(p - [0, S['body_y'], 0], [S['wid'], S['body_h'], S['len']], S['r_body'])
    roof_p = shear_z(p - [0, S['roof_y'], -0.20], S['glass_tilt'], 0.0)
    roof = rbox(roof_p, [S['roof_wid'], S['roof_h'], S['roof_len']], S['r_roof'])
    shell = smin(body, roof, 0.16)
    dists.append(shell); mats.append(MAT_PAINT)

    # lunette : en saillie sur la custode, cerclée d'un joint sombre
    gz = S['roof_len'] - 0.12
    frame_p = shear_z(p - [0, S['roof_y'], gz], S['glass_tilt'], 0.0)
    dists.append(rbox(frame_p, [S['roof_wid'] - 0.03, S['roof_h'] - 0.015, 0.045], 0.03))
    mats.append(MAT_TRIM)
    glass_p = shear_z(p - [0, S['roof_y'], gz + 0.012], S['glass_tilt'], 0.0)
    dists.append(rbox(glass_p, [S['roof_wid'] - 0.09, S['roof_h'] - 0.06, 0.05], 0.02))
    mats.append(MAT_GLASS)

    # rainure de coffre et bas de caisse
    dists.append(rbox(p - [0, S['body_y'] + S['body_h'] - 0.02, S['len'] - 0.02],
                      [S['wid'] - 0.06, 0.012, 0.06], 0.008)); mats.append(MAT_TRIM)
    dists.append(rbox(p - [0, S['body_y'] - S['body_h'] + 0.02, 0],
                      [S['wid'] + 0.005, 0.03, S['len'] - 0.15], 0.02)); mats.append(MAT_TRIM)

    # roues (seules les arrière sont visibles de dos) + jantes
    for zx in (S['wheel_z'], -S['wheel_z'] + 0.1):
        for sx in (-1, 1):
            c = [sx * (S['wid'] - 0.02), S['wheel_r'], zx]
            dists.append(cyl_x(p - c, 0.13, S['wheel_r'])); mats.append(MAT_TYRE)
            dists.append(cyl_x(p - c, 0.14, S['wheel_r'] * 0.55)); mats.append(MAT_RIM)

    # pare-chocs, feux, emplacement de plaque
    z_back = S['len'] + 0.02
    y_low = S['body_y'] - S['body_h']
    dists.append(rbox(p - [0, y_low + 0.075, z_back - 0.035],
                      [S['wid'] + 0.005, 0.105, 0.065], 0.05)); mats.append(MAT_TRIM)
    for sx in (-1, 1):
        dists.append(rbox(p - [sx * (S['wid'] - 0.26), S['body_y'] + 0.15, z_back - 0.045],
                          [0.24, 0.075, 0.05], 0.022)); mats.append(MAT_LAMP)
        dists.append(rbox(p - [sx * (S['wid'] - 0.26), S['body_y'] + 0.235, z_back - 0.05],
                          [0.24, 0.012, 0.045], 0.008)); mats.append(MAT_TRIM)
    # emplacement de plaque, dimensionné pour la plaque lisible posée par le jeu
    dists.append(rbox(p - [0, y_low + 0.20, z_back - 0.055],
                      [0.42, 0.115, 0.03], 0.012)); mats.append(MAT_PLATE)
    dists.append(cyl_x(p - [S['wid'] - 0.34, y_low + 0.015, z_back + 0.01], 0.055, 0.035))
    mats.append(MAT_TRIM)

    D = np.stack(dists, axis=-1)
    idx = np.argmin(D, axis=-1)
    d = np.take_along_axis(D, idx[..., None], axis=-1)[..., 0]
    m = np.array(mats, dtype=np.int8)[idx]
    return d, m

def sdf(p, S):
    return scene(p, S)[0]

def normal(p, S):
    e = 0.0012
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
        t[alive] += d
        still = (d > EPS) & (t[alive] < MAX_DIST)
        idx = np.where(alive)[0]
        alive[idx[~still]] = False
    hit = t < MAX_DIST
    return t, hit

def soft_shadow(ro, rd, S, k=14.0):
    """Ombre douce : on suit le rayon vers la lumière en gardant la marge minimale."""
    res = np.ones(ro.shape[:-1], dtype=np.float32)
    t = np.full(ro.shape[:-1], 0.03, dtype=np.float32)
    alive = np.ones(t.shape, dtype=bool)
    for _ in range(28):
        if not alive.any():
            break
        p = ro[alive] + rd[alive] * t[alive][..., None]
        d = sdf(p, S)
        res[alive] = np.minimum(res[alive], k * d / np.maximum(t[alive], 1e-4))
        t[alive] += np.clip(d, 0.015, 0.4)
        still = (d > 0.002) & (t[alive] < 6.0)
        idx = np.where(alive)[0]
        alive[idx[~still]] = False
    return np.clip(res, 0.0, 1.0)

def ao(p, n, S):
    occ, w = np.zeros(p.shape[:-1], dtype=np.float32), 1.0
    for i in range(1, 5):
        h = 0.035 * i
        occ += (h - sdf(p + n * h, S)) * w
        w *= 0.62
    return np.clip(1.0 - 2.2 * occ, 0.0, 1.0)

# ─────────────── éclairage ───────────────
SUN_DIR   = np.array([0.42, 0.62, 0.66], dtype=np.float32)      # haut-arrière droit : éclaire la face vue
SUN_DIR  /= np.linalg.norm(SUN_DIR)
RIM_DIR   = np.array([-0.35, 0.28, -0.90], dtype=np.float32)    # contre-jour du couchant
RIM_DIR  /= np.linalg.norm(RIM_DIR)
SUN_COL   = np.array([1.00, 0.89, 0.74], dtype=np.float32) * 2.5
SKY_COL   = np.array([0.30, 0.42, 0.68], dtype=np.float32) * 0.42
GROUND_COL= np.array([0.16, 0.15, 0.12], dtype=np.float32) * 0.30
RIM_COL   = np.array([1.00, 0.58, 0.30], dtype=np.float32) * 2.4

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

# ─────────────── rendu d'une silhouette ───────────────
def render(name, S):
    cam = np.array([0.0, 1.40, 6.40], dtype=np.float32)
    tgt = np.array([0.0, 0.78, 0.05], dtype=np.float32)
    fwd = tgt - cam; fwd /= np.linalg.norm(fwd)
    rgt = np.cross(fwd, [0, 1, 0]); rgt /= np.linalg.norm(rgt)
    up  = np.cross(rgt, fwd)
    focal = 4.6

    xs = (np.arange(RW, dtype=np.float32) + 0.5) / RW * 2 - 1
    ys = 1 - (np.arange(RH, dtype=np.float32) + 0.5) / RH * 2
    gx, gy = np.meshgrid(xs, ys)
    gx *= RW / RH
    rd = (fwd + (gx[..., None] * rgt + gy[..., None] * up) / focal).astype(np.float32)
    rd /= np.linalg.norm(rd, axis=-1, keepdims=True)
    rd = rd.reshape(-1, 3)
    ro = np.broadcast_to(cam, rd.shape).copy()

    # sphère englobante : on n'envoie de rayons que là où il peut y avoir de la matière
    oc = ro - np.array([0, 0.85, 0], dtype=np.float32)
    b = (oc * rd).sum(-1)
    c = (oc * oc).sum(-1) - 4.0 ** 2
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
    sh = soft_shadow(p + n * 0.012, np.broadcast_to(SUN_DIR, p.shape).copy(), S)
    occ = ao(p, n, S)
    hemi = 0.5 + 0.5 * n[..., 1]
    rim = np.clip((n * RIM_DIR).sum(-1), 0, 1) ** 2.2

    ambient = (SKY_COL * hemi[..., None] + GROUND_COL * (1 - hemi)[..., None]) * occ[..., None]
    diffuse = SUN_COL * (ndl * sh)[..., None] + ambient + RIM_COL * (rim * occ)[..., None] * 0.5

    rough = np.select([mat == MAT_PAINT, mat == MAT_GLASS, mat == MAT_TYRE,
                       mat == MAT_RIM, mat == MAT_LAMP, mat == MAT_TRIM, mat == MAT_PLATE],
                      [0.17, 0.05, 0.92, 0.28, 0.14, 0.82, 0.88], 0.4)
    spec = ggx(n, v, np.broadcast_to(SUN_DIR, p.shape), rough) * sh * occ
    spec_col = SUN_COL * spec[..., None]
    spec_col += SKY_COL * (ggx(n, v, np.broadcast_to(np.array([0, 1, 0.35]) /
                np.linalg.norm([0, 1, 0.35]), p.shape).astype(np.float32), rough) * occ)[..., None] * 2.2

    base = np.select(
        [(mat == MAT_GLASS)[..., None], (mat == MAT_TYRE)[..., None], (mat == MAT_RIM)[..., None],
         (mat == MAT_LAMP)[..., None], (mat == MAT_TRIM)[..., None], (mat == MAT_PLATE)[..., None]],
        [np.array([0.008, 0.011, 0.017]), np.array([0.0075, 0.0075, 0.008]),
         np.array([0.16, 0.17, 0.19]), np.array([0.26, 0.014, 0.010]),
         np.array([0.011, 0.012, 0.014]), np.array([0.013, 0.013, 0.014])],
        np.array([1.0, 1.0, 1.0]))

    emissive = np.where((mat == MAT_LAMP)[..., None], np.array([0.90, 0.05, 0.03]) * 0.30, 0.0)

    is_paint = (mat == MAT_PAINT)
    lit_other = base * diffuse + spec_col + emissive

    return dict(shape=(RH, RW), idx=idx, is_paint=is_paint,
                diffuse=diffuse, spec=spec_col, other=lit_other)

def compose(buf, paint_rgb, crop=None, out_w=None):
    """Applique une couleur de carrosserie aux tampons d'éclairage déjà calculés."""
    RHh, RWw = buf['shape']
    img = np.zeros((RHh * RWw, 3), dtype=np.float32)
    alpha = np.zeros(RHh * RWw, dtype=np.float32)
    col = np.asarray(paint_rgb, dtype=np.float32)
    lit_paint = col * buf['diffuse'] + buf['spec']
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
    cam = np.array([0.0, 1.40, 6.40]); tgt = np.array([0.0, 0.78, 0.05])
    fwd = tgt - cam; fwd /= np.linalg.norm(fwd)
    rgt = np.cross(fwd, [0, 1, 0]); rgt /= np.linalg.norm(rgt)
    up = np.cross(rgt, fwd); focal = 4.6; aspect = RW / RH
    if 'plate' in S:
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
        gx = (cx_ / cz_) * focal / aspect
        gy = (cy_ / cz_) * focal
        xs.append((gx + 1) / 2); ys.append((1 - gy) / 2)
    return dict(x=min(xs), y=min(ys), w=max(xs) - min(xs), h=max(ys) - min(ys))

COLORS = {
  'rouge':  (0.50, 0.040, 0.030),
  'bleu':   (0.035, 0.135, 0.50),
  'blanc':  (0.86, 0.87, 0.88),
  'noir':   (0.028, 0.032, 0.040),
  'vert':   (0.035, 0.26, 0.145),
  'jaune':  (0.72, 0.50, 0.030),
  'gris':   (0.26, 0.285, 0.32),
  'orange': (0.72, 0.22, 0.028),
  'violet': (0.30, 0.10, 0.52),
  'chrome': (0.62, 0.66, 0.72),
  'nacre':  (0.90, 0.80, 0.86),
  'or':     (0.92, 0.62, 0.14),
  'bronze': (0.60, 0.32, 0.12),
  'argent': (0.74, 0.77, 0.82),
}

if __name__ == '__main__':
    os.makedirs(OUT, exist_ok=True)
    import time, json
    layout = {}
    only = sys.argv[2].split(',') if len(sys.argv) > 2 else None
    if only:
        SHAPES = {k: v for k, v in SHAPES.items() if k in only}
        COLORS = {k: v for k, v in COLORS.items() if k in (sys.argv[3].split(',') if len(sys.argv) > 3 else COLORS)}
    for name, S in SHAPES.items():
        t0 = time.time()
        buf = render(name, S)
        print('%-9s géométrie rendue en %5.1f s' % (name, time.time() - t0))

        # recadrage au plus juste : le sprite ne transporte pas de vide
        ref = compose(buf, (0.5, 0.5, 0.5))
        bb = ref.getbbox()
        pad = 3
        crop = (max(0, bb[0] - pad), max(0, bb[1] - pad),
                min(ref.width, bb[2] + pad), min(ref.height, bb[3] + pad))
        cw, ch = crop[2] - crop[0], crop[3] - crop[1]

        pb = plate_box(S)                       # fractions de l'image PLEINE
        layout[name] = dict(
            x=(pb['x'] * ref.width - crop[0]) / cw,
            y=(pb['y'] * ref.height - crop[1]) / ch,
            w=pb['w'] * ref.width / cw,
            h=pb['h'] * ref.height / ch,
            ratio=round(cw / ch, 4))

        for cname, rgb in COLORS.items():
            im = compose(buf, rgb, crop=crop, out_w=OUT_W)
            path = os.path.join(OUT, '%s-%s.webp' % (name, cname))
            im.save(path, 'WEBP', quality=86, method=6)
            print('   %-28s %5.1f Ko' % (os.path.basename(path), os.path.getsize(path) / 1024))
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

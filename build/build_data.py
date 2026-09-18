# -*- coding: utf-8 -*-
"""Construit js/dict.js (dictionnaire compresse) et js/pairs.js (paires de lettres)
a partir de Lexique383 (http://www.lexique.org)."""
import csv, gzip, base64, json, re, sys, unicodedata
from collections import defaultdict

SRC = sys.argv[1]
OUT = sys.argv[2]

# Lettres autorisees par le SIV francais : pas de I, O, U
SIV = [c for c in "ABCDEFGHJKLMNPQRSTVWXYZ"]

def strip_accents(s):
    s = unicodedata.normalize('NFD', s)
    return ''.join(c for c in s if unicodedata.category(c) != 'Mn').lower()

word_re = re.compile(r'^[a-z]{3,14}$')

best = {}   # forme normalisee -> (freq, orthographe accentuee, cgram)
for r in csv.DictReader(open(SRC, encoding='utf-8'), delimiter='\t'):
    ortho = r['ortho']
    n = strip_accents(ortho)
    if not word_re.match(n):
        continue
    try:
        f = float(r['freqfilms2']) + float(r['freqlivres'])
    except ValueError:
        f = 0.0
    if n not in best or f > best[n][0]:
        best[n] = (f, ortho, r['cgram'])

words = sorted(best)
print("dictionnaire :", len(words), "mots")

# --- dictionnaire compresse ---
blob = '\n'.join(words).encode('utf-8')
gz = gzip.compress(blob, 9)
b64 = base64.b64encode(gz).decode('ascii')
print("brut %.0f Ko -> gzip %.0f Ko -> base64 %.0f Ko" % (len(blob)/1024, len(gz)/1024, len(b64)/1024))

# --- rarete : 0 courant, 1 peu courant, 2 rare (un caractere par mot, meme ordre) ---
def tier(f):
    if f >= 3.0:  return '0'
    if f >= 0.30: return '1'
    return '2'
tiers = ''.join(tier(best[w][0]) for w in words)
from collections import Counter
print("rarete :", dict(Counter(tiers)))
tgz = gzip.compress(tiers.encode('ascii'), 9)
tb64 = base64.b64encode(tgz).decode('ascii')
print("piste rarete -> base64 %.0f Ko" % (len(tb64)/1024,))

# --- mots courants, utilises pour noter les paires et donner des exemples ---
COMMON = 2.0
common = [w for w in words if best[w][0] >= COMMON and 4 <= len(w) <= 12]
print("mots courants :", len(common))

def m_ord(w, a, b):      # regle unique : a puis b, n'importe ou dans le mot
    i = w.find(a)        # PL -> Pologne, PLongeon, PaLudisme, exPLoser
    return i != -1 and w.find(b, i + 1) != -1

pairs = {}
for a in SIV:
    la = a.lower()
    for b in SIV:
        lb = b.lower()
        hits = [w for w in common if m_ord(w, la, lb)]
        if not hits:
            continue
        hits.sort(key=lambda w: -best[w][0])
        ex, used = [], set()
        for w in hits:
            if not (5 <= len(w) <= 11):
                continue
            if w[:4] in used:      # evite fille/filles/fillette cote a cote
                continue
            used.add(w[:4])
            ex.append(best[w][1])
            if len(ex) == 12:
                break
        pairs[a + b] = {"n": len(hits), "ex": ex}

ranked = sorted(pairs.items(), key=lambda kv: -kv[1]["n"])
print("\ntop 12 paires :")
for k, v in ranked[:12]:
    print("  %s %5d  %s" % (k, v["n"], ", ".join(v["ex"][:4])))
print("\nrang 150-162 :")
for k, v in ranked[150:162]:
    print("  %s %5d  %s" % (k, v["n"], ", ".join(v["ex"][:4])))

# On ne garde que les paires avec assez de matiere pour une manche
playable = [(k, v) for k, v in ranked if v["n"] >= 40 and len(v["ex"]) >= 8]
print("\npaires jouables :", len(playable), " (n min =", playable[-1][1]["n"], ")")
out_pairs = [{"p": k, "n": v["n"], "ex": v["ex"]} for k, v in playable]

with open(OUT + '/pairs.js', 'w', encoding='utf-8') as f:
    f.write("// Paires jouables. n = nombre de mots courants contenant les deux lettres dans l'ordre.\n")
    f.write("window.PAIRS = " + json.dumps(out_pairs, ensure_ascii=False) + ";\n")

with open(OUT + '/dict.js', 'w', encoding='utf-8') as f:
    f.write("// Dictionnaire francais compresse (gzip+base64), genere depuis Lexique383 - lexique.org\n")
    f.write("// %d mots, sans accents ni traits d'union\n" % len(words))
    f.write("window.DICT_GZ_B64 = \"%s\";\n" % b64)
    f.write("// Rarete alignee sur le dictionnaire : 0 = courant, 1 = peu courant, 2 = rare\n")
    f.write("window.RARITY_GZ_B64 = \"%s\";\n" % tb64)

print("\necrit dans", OUT)

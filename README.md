[pytest]
# Le filet de securite vit dans tests/ et tourne entierement hors-ligne.
# Les anciens scripts test_*.py a la racine (test_all.py, test_v6.py, test_v7.py...)
# sont des programmes autonomes lances avec `python`, pas des tests pytest :
# on ne les collecte donc pas ici.
testpaths = tests
addopts = -q

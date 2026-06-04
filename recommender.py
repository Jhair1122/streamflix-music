import math
import random

# ── Filtrado colaborativo KNN (pesos: like=1, favorito=0.5) ──
def collaborative_filtering(user_id, my_inter, all_inter, all_songs):
    # Construir perfil de pesos del usuario
    my_weights = {}
    for inter in my_inter:
        if inter["es_like"]:
            my_weights[inter["cancion_id"]] = my_weights.get(inter["cancion_id"], 0) + 1
        if inter["es_favorito"]:
            my_weights[inter["cancion_id"]] = my_weights.get(inter["cancion_id"], 0) + 0.5

    if not my_weights:
        return []

    # Perfiles de otros usuarios
    others = {}
    for inter in all_inter:
        if inter["usuario_id"] == user_id:
            continue
        uid = inter["usuario_id"]
        if uid not in others:
            others[uid] = {}
        w = 1 if inter["es_like"] else 0.5
        others[uid][inter["cancion_id"]] = others[uid].get(inter["cancion_id"], 0) + w

    # Similitud coseno
    sims = []
    for uid, nw in others.items():
        intersection = 0.0
        norm_u = sum(w * w for w in my_weights.values())
        norm_v = sum(w * w for w in nw.values())
        for sid, wu in my_weights.items():
            wv = nw.get(sid, 0)
            intersection += wu * wv
        sim = intersection / (math.sqrt(norm_u) * math.sqrt(norm_v) + 1e-9)
        if sim > 0:
            sims.append((uid, sim, nw))
    sims.sort(key=lambda x: x[1], reverse=True)

    # Ponderar candidatos
    candidates = {}
    for _, sim, nw in sims[:3]:
        for sid, w in nw.items():
            if sid in my_weights:
                continue
            candidates[sid] = candidates.get(sid, 0) + sim * w
    sorted_candidates = sorted(candidates.items(), key=lambda x: x[1], reverse=True)
    rec_ids = [sid for sid, _ in sorted_candidates[:10]]
    return [s for s in all_songs if s["id"] in rec_ids]


# ── Árbol de decisión J48 simplificado (solo para análisis) ──
def build_decision_tree(all_inter, all_songs):
    datos = []
    for inter in all_inter:
        song = next((s for s in all_songs if s["id"] == inter["cancion_id"]), None)
        if song:
            datos.append({
                "energia": song.get("energia", 0.5),
                "bailabilidad": song.get("bailabilidad", 0.5),
                "popularidad": song.get("popularidad", 50),
                "genero": song["genero"],
                "like": 1 if (inter["es_like"] or inter["es_favorito"]) else 0
            })
    if len(datos) < 3:
        return None

    by_genre = {}
    for d in datos:
        gen = d["genero"]
        if gen not in by_genre:
            by_genre[gen] = {"likes": 0, "total": 0}
        by_genre[gen]["total"] += 1
        if d["like"]:
            by_genre[gen]["likes"] += 1

    avg_en = sum(d.get("energia", 0.5) for d in datos) / len(datos)
    avg_bai = sum(d.get("bailabilidad", 0.5) for d in datos) / len(datos)
    avg_pop = sum(d.get("popularidad", 50) for d in datos) / len(datos)

    accuracy = max(
        sum(1 for d in datos if d["like"]),
        len(datos) - sum(1 for d in datos if d["like"])
    ) / len(datos) * 100

    return {
        "by_genre": by_genre,
        "avg_en": avg_en,
        "avg_bai": avg_bai,
        "avg_pop": avg_pop,
        "accuracy": round(accuracy)
    }

def predict_tree(song, model):
    if not model:
        return False
    gd = model["by_genre"].get(song.get("genero", ""), {"likes": 0, "total": 1})
    rate = gd["likes"] / gd["total"] if gd["total"] > 0 else 0.5
    score = 0
    if rate > 0.55:
        score += 3
    elif rate > 0.4:
        score += 1
    if song.get("energia", 0.5) >= model["avg_en"] - 0.05:
        score += 1
    if song.get("bailabilidad", 0.5) >= model["avg_bai"] - 0.05:
        score += 1
    if song.get("popularidad", 50) >= model["avg_pop"]:
        score += 1
    return score >= 4


# ── Playlist recursiva BASADA SOLO EN GÉNERO ──
def recursive_playlist(seed_id, depth, visited, all_songs):
    if depth == 0 or not seed_id:
        return []
    seed = next((s for s in all_songs if s["id"] == seed_id), None)
    if not seed or seed_id in visited:
        return []
    visited.add(seed_id)

    # Puntuación simple: 3 si coincide el género, 0 en caso contrario
    candidates = [
        {
            "s": s,
            "score": 3 if s["genero"] == seed["genero"] else 0
        }
        for s in all_songs if s["id"] not in visited
    ]
    if not candidates:
        return []

    # En caso de empate, usamos popularidad como desempate (si existe)
    best = max(candidates, key=lambda x: (x["score"], x["s"].get("popularidad", 0)))
    return [best["s"]] + recursive_playlist(best["s"]["id"], depth - 1, visited, all_songs)


# ── Validación cruzada k=5 ──
def cross_validation(all_inter, all_songs, k=5):
    data = []
    for inter in all_inter:
        song = next((s for s in all_songs if s["id"] == inter["cancion_id"]), None)
        if song:
            data.append({
                "energia": song.get("energia", 0.5),
                "bailabilidad": song.get("bailabilidad", 0.5),
                "popularidad": song.get("popularidad", 50),
                "genero": song["genero"],
                "like": 1 if (inter["es_like"] or inter["es_favorito"]) else 0
            })
    if len(data) < k:
        return []
    random.shuffle(data)
    fold_size = len(data) // k
    folds = []
    for i in range(k):
        test = data[i * fold_size : (i + 1) * fold_size]
        train = data[: i * fold_size] + data[(i + 1) * fold_size :]
        by_genre = {}
        sum_en = sum_bai = sum_pop = likes_count = 0
        for d in train:
            gen = d["genero"]
            if gen not in by_genre:
                by_genre[gen] = {"likes": 0, "total": 0}
            by_genre[gen]["total"] += 1
            if d["like"]:
                by_genre[gen]["likes"] += 1
                sum_en += d.get("energia", 0.5)
                sum_bai += d.get("bailabilidad", 0.5)
                sum_pop += d.get("popularidad", 50)
                likes_count += 1

        avg_en = sum_en / likes_count if likes_count else 0.5
        avg_bai = sum_bai / likes_count if likes_count else 0.5
        avg_pop = sum_pop / likes_count if likes_count else 50

        correct = detected = 0
        for d in test:
            gd = by_genre.get(d["genero"], {"likes": 0, "total": 1})
            rate = gd["likes"] / gd["total"] if gd["total"] > 0 else 0.5
            score = 0
            if rate > 0.55:
                score += 3
            elif rate > 0.4:
                score += 1
            if d.get("energia", 0.5) >= avg_en - 0.05:
                score += 1
            if d.get("bailabilidad", 0.5) >= avg_bai - 0.05:
                score += 1
            if d.get("popularidad", 50) >= avg_pop:
                score += 1
            pred = 1 if score >= 4 else 0
            if pred == d["like"]:
                correct += 1
            if pred == 1 and d["like"] == 1:
                detected += 1
        acc = round(correct / len(test) * 100) if test else 0
        folds.append({
            "fold": i + 1,
            "train": len(train),
            "test": len(test),
            "accuracy": acc,
            "detected": detected
        })
    return folds

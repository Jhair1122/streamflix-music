import os
import traceback
from flask import Flask, request, jsonify
from flask_cors import CORS
from db import supabase
from recommender import (
    collaborative_filtering,
    build_decision_tree,
    predict_tree,
    recursive_playlist,
    cross_validation
)

app = Flask(__name__)
CORS(app, resources={r"/api/*": {"origins": "*"}})

# -------------------------------------------------------------------
# Canciones
# -------------------------------------------------------------------
@app.route("/api/songs")
def get_songs():
    try:
        # Ordena por id (más reciente primero) en lugar de popularidad
        res = supabase.table("canciones").select("*").order("id", desc=True).execute()
        return jsonify({"data": res.data})
    except Exception as e:
        return jsonify({"error": str(e)}), 500

@app.route("/api/my-interactions")
def my_interactions():
    user_id = request.args.get("user_id")
    if not user_id:
        return jsonify({"error": "user_id requerido"}), 400
    try:
        res = supabase.table("interacciones").select("*").eq("usuario_id", user_id).execute()
        return jsonify({"data": res.data})
    except Exception as e:
        return jsonify({"error": str(e)}), 500

@app.route("/api/popular")
def popular_songs():
    try:
        all_inter = supabase.table("interacciones").select("cancion_id").execute().data
        count = {}
        for inter in all_inter:
            cid = inter["cancion_id"]
            count[cid] = count.get(cid, 0) + 1
        popular_ids = sorted(count, key=count.get, reverse=True)[:10]
        if not popular_ids:
            return jsonify({"popular": []})
        songs = supabase.table("canciones").select("*").in_("id", popular_ids).execute()
        return jsonify({"popular": songs.data})
    except Exception as e:
        return jsonify({"error": str(e)}), 500

@app.route("/api/recommend")
def recommend():
    user_id = request.args.get("user_id")
    if not user_id:
        return jsonify({"recommendations": []})
    try:
        my_inter = supabase.table("interacciones").select("*").eq("usuario_id", user_id).execute().data
        all_inter = supabase.table("interacciones").select("*").execute().data
        songs_res = supabase.table("canciones").select("*").execute()
        all_songs = songs_res.data
        recs = collaborative_filtering(user_id, my_inter, all_inter, all_songs)
        return jsonify({"recommendations": recs})
    except Exception as e:
        return jsonify({"error": str(e)}), 500

@app.route("/api/like", methods=["POST"])
def toggle_like():
    try:
        data = request.json
        user_id = data.get("user_id")
        song_id = data.get("song_id")
        if not user_id or not song_id:
            return jsonify({"error": "Faltan datos"}), 400

        existing = supabase.table("interacciones").select("*").eq("usuario_id", user_id).eq("cancion_id", song_id).execute()
        if existing.data:
            inter = existing.data[0]
            new_val = not inter["es_like"]
            supabase.table("interacciones").update({"es_like": new_val}).eq("id", inter["id"]).execute()
            return jsonify({"es_like": new_val})
        else:
            supabase.table("interacciones").insert({
                "usuario_id": user_id,
                "cancion_id": song_id,
                "es_like": True,
                "es_favorito": False
            }).execute()
            return jsonify({"es_like": True})
    except Exception as e:
        return jsonify({"error": str(e)}), 500

@app.route("/api/favorite", methods=["POST"])
def toggle_favorite():
    try:
        data = request.json
        user_id = data.get("user_id")
        song_id = data.get("song_id")
        if not user_id or not song_id:
            return jsonify({"error": "Faltan datos"}), 400

        existing = supabase.table("interacciones").select("*").eq("usuario_id", user_id).eq("cancion_id", song_id).execute()
        if existing.data:
            inter = existing.data[0]
            new_val = not inter["es_favorito"]
            supabase.table("interacciones").update({"es_favorito": new_val}).eq("id", inter["id"]).execute()
            return jsonify({"es_favorito": new_val})
        else:
            supabase.table("interacciones").insert({
                "usuario_id": user_id,
                "cancion_id": song_id,
                "es_like": False,
                "es_favorito": True
            }).execute()
            return jsonify({"es_favorito": True})
    except Exception as e:
        return jsonify({"error": str(e)}), 500

@app.route("/api/login", methods=["POST"])
def login():
    try:
        data = request.json
        username = data.get("username")
        password = data.get("password")
        if not username or not password:
            return jsonify({"error": "Usuario y contraseña requeridos"}), 400

        res = supabase.table("usuarios").select("*").eq("username", username).eq("password", password).execute()
        if not res.data:
            return jsonify({"error": "Credenciales inválidas"}), 401
        return jsonify({"user": res.data[0]})
    except Exception as e:
        print(f"Error en login: {e}")
        traceback.print_exc()
        return jsonify({"error": "Error interno del servidor"}), 500

@app.route("/api/register", methods=["POST"])
def register():
    try:
        data = request.json
        nombre = data.get("nombre")
        username = data.get("username")
        password = data.get("password")
        if not nombre or not username or not password:
            return jsonify({"error": "Todos los campos son obligatorios"}), 400

        existing = supabase.table("usuarios").select("id").eq("username", username).execute()
        if existing.data:
            return jsonify({"error": "El usuario ya existe"}), 409

        res = supabase.table("usuarios").insert({
            "nombre": nombre,
            "username": username,
            "password": password
        }).execute()

        if not res.data:
            return jsonify({"error": "Error al crear el usuario"}), 500

        return jsonify({"user": res.data[0]})
    except Exception as e:
        print(f"Error en registro: {e}")
        traceback.print_exc()
        return jsonify({"error": "Error interno del servidor"}), 500

@app.route("/api/weekly")
def discover_weekly():
    user_id = request.args.get("user_id")
    if not user_id:
        return jsonify({"weekly": []})
    try:
        my_inter = supabase.table("interacciones").select("*").eq("usuario_id", user_id).execute().data
        if not my_inter:
            return jsonify({"weekly": []})
        best = max(my_inter, key=lambda x: (x["es_like"] * 1) + (x["es_favorito"] * 0.5))
        seed_id = best["cancion_id"]
        all_songs = supabase.table("canciones").select("*").execute().data
        playlist = recursive_playlist(seed_id, 12, set(), all_songs)
        return jsonify({"weekly": playlist})
    except Exception as e:
        return jsonify({"error": str(e)}), 500

@app.route("/api/analysis")
def analysis():
    user_id = request.args.get("user_id")
    if not user_id:
        return jsonify({})
    try:
        all_inter = supabase.table("interacciones").select("*").execute().data
        all_songs = supabase.table("canciones").select("*").execute().data
        my_inter = supabase.table("interacciones").select("*").eq("usuario_id", user_id).execute().data

        users = supabase.table("usuarios").select("id").execute().data
        total_users = len(users)
        total_songs = len(all_songs)
        total_inter = len(all_inter)
        total_likes = sum(1 for i in all_inter if i["es_like"] or i["es_favorito"])
        avg_likes = round(total_likes / total_users, 1) if total_users else 0

        model = build_decision_tree(all_inter, all_songs)
        accuracy = model["accuracy"] if model else 85

        genre_count = {}
        for inter in my_inter:
            if inter["es_like"] or inter["es_favorito"]:
                song = next((s for s in all_songs if s["id"] == inter["cancion_id"]), None)
                if song:
                    gen = song["genero"]
                    genre_count[gen] = genre_count.get(gen, 0) + 1
        genre_chart = dict(sorted(genre_count.items(), key=lambda x: x[1], reverse=True))

        tree_rules = "Árbol de decisión J48 simplificado.\n"
        if model:
            for gen, stats in model["by_genre"].items():
                rate = round(stats["likes"] / stats["total"] * 100)
                tree_rules += f"Si género = \"{gen}\" → tasa de likes = {rate}%\n"
            tree_rules += f"\nPromedios: energía ≥ {model['avg_en']:.2f}, bailabilidad ≥ {model['avg_bai']:.2f}, popularidad ≥ {model['avg_pop']:.2f}\nRegla: Score ≥ 4 → Recomendar."

        cv = cross_validation(all_inter, all_songs)

        return jsonify({
            "metrics": {
                "users": total_users,
                "songs": total_songs,
                "interactions": total_inter,
                "likes": total_likes,
                "accuracy": f"{accuracy}%",
                "avg_likes_per_user": str(avg_likes)
            },
            "genre_chart": genre_chart,
            "tree_rules": tree_rules,
            "cross_validation": cv
        })
    except Exception as e:
        return jsonify({"error": str(e)}), 500

# -------------------------------------------------------------------
# CHAT
# -------------------------------------------------------------------
@app.route("/api/messages", methods=["GET"])
def get_messages():
    try:
        res = supabase.table("mensajes").select("*").order("created_at", desc=False).limit(100).execute()
        return jsonify({"messages": res.data})
    except Exception as e:
        return jsonify({"error": str(e)}), 500

@app.route("/api/messages", methods=["POST"])
def post_message():
    try:
        data = request.json
        user_id = data.get("user_id")
        username = data.get("username")
        mensaje = data.get("mensaje")
        if not user_id or not username or not mensaje:
            return jsonify({"error": "Faltan datos"}), 400
        supabase.table("mensajes").insert({
            "user_id": user_id,
            "username": username,
            "mensaje": mensaje
        }).execute()
        return jsonify({"success": True})
    except Exception as e:
        return jsonify({"error": str(e)}), 500

if __name__ == "__main__":
    app.run(host="0.0.0.0", port=int(os.getenv("PORT", 8000)))

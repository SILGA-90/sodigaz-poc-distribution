"""
Serializers pour l'authentification JWT.

Ce module définit deux serializers :
  - LivreurTokenObtainPairSerializer : échange code_livreur + password contre
    des tokens JWT, avec enrichissement du payload access.
  - UtilisateurMeSerializer : représentation publique de l'utilisateur connecté
    retournée par GET /api/auth/me/.

Les livreurs sont identifiés sur le
terrain par un code court (LIV001, LIV002...), pas par un username long.
L'application mobile présente un champ "Code livreur", et le serializer
fait la traduction code_livreur -> username avant d'appeler authenticate().

Le token JWT standard ne contient
que l'user_id. On ajoute code_livreur, nom_complet et role pour que le
mobile puisse lire ces informations sans appeler /me/ à chaque démarrage.
Ces claims sont signés par la clé secrète Django : ils ne peuvent pas être
falsifiés côté client.

authenticate() de Django
cherche uniquement par username_field (défini à "username" dans Utilisateur).
On fait d'abord un SELECT par code_livreur pour récupérer l'username, puis
on passe à authenticate() qui vérifie le hash du mot de passe et que le
compte est actif (is_active=True).
"""
from django.contrib.auth import authenticate, get_user_model
from rest_framework import serializers
from rest_framework_simplejwt.serializers import TokenObtainPairSerializer
from rest_framework_simplejwt.tokens import RefreshToken

Utilisateur = get_user_model()


class LivreurTokenObtainPairSerializer(serializers.Serializer):
    """
    Connexion par code_livreur + password : retourne access + refresh tokens.
    TokenObtainPairSerializer
         s'appuie sur username_field pour la validation. Notre champ d'entrée
         est code_livreur : on surcharge complètement la validation pour faire
         la résolution en deux étapes (voir module docstring).
    """
    code_livreur = serializers.CharField(required=True)
    password     = serializers.CharField(required=True, write_only=True)

    def validate(self, attrs):
        code_livreur = attrs.get("code_livreur")
        password     = attrs.get("password")

        # Étape 1 : résoudre le code_livreur en objet utilisateur
        try:
            user = Utilisateur.objects.get(code_livreur=code_livreur)
        except Utilisateur.DoesNotExist:
            raise serializers.ValidationError(
                "Aucun compte actif trouvé avec ces identifiants.",
                code="no_active_account",
            )

        # Étape 2 : authentifier via le mécanisme standard Django
        # (vérifie le hash du mot de passe et que le compte est actif)
        authenticated_user = authenticate(
            request=self.context.get("request"),
            username=user.username,
            password=password,
        )
        if authenticated_user is None:
            raise serializers.ValidationError(
                "Aucun compte actif trouvé avec ces identifiants.",
                code="no_active_account",
            )

        # Étape 3 : générer les tokens JWT et enrichir le payload access
        refresh = RefreshToken.for_user(authenticated_user)
        access  = refresh.access_token
        # Claims supplémentaires signés dans le token access
        access["code_livreur"] = authenticated_user.code_livreur
        access["nom_complet"]  = (
            authenticated_user.get_full_name() or authenticated_user.username
        )
        access["role"] = authenticated_user.role

        return {
            "access":  str(access),
            "refresh": str(refresh),
        }


class UtilisateurMeSerializer(serializers.ModelSerializer):
    """
    Représentation publique de l'utilisateur connecté.
    Cet endpoint n'est utilisé qu'en lecture :
         aucun champ ne doit être modifiable via /me/. Les modifications de profil
         passent par l'admin Django ou un endpoint dédié.
    """
    class Meta:
        model         = Utilisateur
        fields        = (
            "id", "username", "code_livreur", "first_name", "last_name",
            "telephone", "role", "is_active",
        )
        read_only_fields = fields

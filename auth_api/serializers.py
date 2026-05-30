"""
Serializers pour l'authentification JWT.

Notre modele Utilisateur a `code_livreur` en plus de `username`. On veut
permettre la connexion par code_livreur. Comme django.contrib.auth.authenticate
ne sait chercher que par `username` (le USERNAME_FIELD du modele), on resout
manuellement le code_livreur en username avant l'authentification.
"""
from django.contrib.auth import authenticate, get_user_model
from rest_framework import serializers
from rest_framework_simplejwt.serializers import TokenObtainPairSerializer
from rest_framework_simplejwt.tokens import RefreshToken

Utilisateur = get_user_model()


class LivreurTokenObtainPairSerializer(serializers.Serializer):
    """Connexion par code_livreur + password, retourne access + refresh."""

    code_livreur = serializers.CharField(required=True)
    password = serializers.CharField(required=True, write_only=True)

    def validate(self, attrs):
        code_livreur = attrs.get("code_livreur")
        password = attrs.get("password")

        # 1. Resoudre le code_livreur en utilisateur
        try:
            user = Utilisateur.objects.get(code_livreur=code_livreur)
        except Utilisateur.DoesNotExist:
            raise serializers.ValidationError(
                "Aucun compte actif trouve avec ces identifiants.",
                code="no_active_account",
            )

        # 2. Authentifier avec le mecanisme standard Django (verifie le hash
        #    du mot de passe et que le compte est actif)
        authenticated_user = authenticate(
            request=self.context.get("request"),
            username=user.username,
            password=password,
        )
        if authenticated_user is None:
            raise serializers.ValidationError(
                "Aucun compte actif trouve avec ces identifiants.",
                code="no_active_account",
            )

        # 3. Generer les tokens
        refresh = RefreshToken.for_user(authenticated_user)

        # 4. Enrichir le token access avec des claims utiles cote mobile
        access = refresh.access_token
        access["code_livreur"] = authenticated_user.code_livreur
        access["nom_complet"] = (
            authenticated_user.get_full_name() or authenticated_user.username
        )
        access["role"] = authenticated_user.role

        return {
            "access": str(access),
            "refresh": str(refresh),
        }


class UtilisateurMeSerializer(serializers.ModelSerializer):
    """Informations du livreur connecte (endpoint /me/)."""

    class Meta:
        model = Utilisateur
        fields = (
            "id", "username", "code_livreur", "first_name", "last_name",
            "telephone", "role", "is_active",
        )
        read_only_fields = fields

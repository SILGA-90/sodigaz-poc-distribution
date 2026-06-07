from django.urls import path
from rest_framework_simplejwt.views import TokenRefreshView

from .views import LivreurTokenObtainPairView, me, verify_dev_access

app_name = "auth_api"

urlpatterns = [
    path("login/", LivreurTokenObtainPairView.as_view(), name="login"),
    path("refresh/", TokenRefreshView.as_view(), name="refresh"),
    path("me/", me, name="me"),
    path("dev-access/", verify_dev_access, name="dev-access"),
]

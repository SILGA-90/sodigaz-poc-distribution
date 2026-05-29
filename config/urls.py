from django.contrib import admin
from django.urls import include, path

urlpatterns = [
    path("admin/", admin.site.urls),
    path("api/mock-x3/", include("mock_x3.urls")),
]

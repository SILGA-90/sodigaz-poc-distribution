from django.apps import AppConfig


class MockX3Config(AppConfig):
    default_auto_field = "django.db.models.BigAutoField"
    name = "mock_x3"
    verbose_name = "Simulation Sage X3"

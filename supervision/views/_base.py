"""Utilitaires partagés entre les vues de supervision."""
from datetime import date as date_cls, datetime as datetime_cls


def _get_date_filter(request, write_session: bool = False) -> date_cls:
    """
    Résout le filtre de date actif (priorité décroissante) :
      1. Paramètre GET 'date'  → met à jour la session si write_session=True
      2. Session 'date_filter' → persistance cross-page
      3. Aujourd'hui           → fallback
    """
    date_str = request.GET.get("date", "").strip()
    if date_str:
        try:
            d = datetime_cls.strptime(date_str, "%Y-%m-%d").date()
            if write_session:
                request.session["date_filter"] = date_str
            return d
        except ValueError:
            pass
    session_date = request.session.get("date_filter", "")
    if session_date:
        try:
            return datetime_cls.strptime(session_date, "%Y-%m-%d").date()
        except ValueError:
            pass
    return date_cls.today()

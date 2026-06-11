"""
Utilitaires partagés entre les vues de supervision.

Ce module expose _get_date_filter(), helper commun à toutes les vues
de supervision pour résoudre la date de filtrage active.

Toutes les vues de supervision (dashboard, programmes,
opérations, anomalies, livreurs) permettent de naviguer entre les journées.
La logique de résolution (GET > session > aujourd'hui) est identique partout ;
la centraliser évite la duplication et garantit un comportement cohérent.
"""
from datetime import date as date_cls, datetime as datetime_cls


def _get_date_filter(request, write_session: bool = False) -> date_cls:
    """
    Résout le filtre de date actif selon une priorité décroissante :
      1. Paramètre GET 'date'   -> date explicitement demandée par l'utilisateur
      2. Session 'date_filter'  -> dernière date visitée (persistance cross-page)
      3. Aujourd'hui            -> fallback si rien n'est défini

    Paramètre write_session :
      True  -> la date du GET est mémorisée en session (à utiliser sur les vues
               qui "possèdent" la navigation par date : dashboard, programmes...).
      False -> lecture seule de la session (vues AJAX qui lisent la date courante
               sans la modifier, ex. dashboard_carte_data).

    L'utilisateur veut consulter les données du 10 juin, puis
         naviguer entre les différentes pages de supervision : programmes,
         opérations, livreurs : sans avoir à resaisir la date à chaque fois.
         La session Django maintient cette cohérence entre les vues.
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

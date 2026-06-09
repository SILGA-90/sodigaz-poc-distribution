// Tokens de design SODIGAZ — source unique de vérité.

export const Colors = {
  // ── Marque ──────────────────────────────────────────────────────────────
  brandBlue:    '#079BD9',
  brandBlueD:   '#0670A0',   // état pressé / ombre bleu
  brandOrange:  '#EE7202',
  brandOrangeD: '#c45e00',   // état pressé / ombre orange
  brandAmber:   '#FAB848',
  navy:         '#0a1628',   // header app, fond branded
  navyMid:      '#112240',

  // ── Sémantique ──────────────────────────────────────────────────────────
  success:       '#16a34a',
  successBg:     '#dcfce7',
  successBorder: '#86efac',
  danger:        '#dc2626',
  dangerBg:      '#fef2f2',
  dangerBorder:  '#fca5a5',
  warning:       '#d97706',
  warningBg:     '#fffbeb',
  warningBorder: '#fcd34d',
  info:          '#079BD9',
  infoBg:        '#e0f2fe',
  infoBorder:    '#7dd3fc',

  // ── Texte ────────────────────────────────────────────────────────────────
  text:           '#0f172a',   // texte principal — très haut contraste
  textSub:        '#334155',   // texte secondaire
  textMuted:      '#64748b',   // libellés, métadonnées — lisible en plein soleil
  textLight:      '#94a3b8',   // captions only, jamais info critique
  textOnDark:     '#ffffff',
  textOnDarkSub:  'rgba(255,255,255,0.65)',
  textOnDarkMuted:'rgba(255,255,255,0.4)',

  // ── Surfaces ─────────────────────────────────────────────────────────────
  bg:          '#f0f4f8',   // fond d'écran (body)
  surface:     '#ffffff',   // cartes
  surface2:    '#f8fafc',   // surfaces secondaires
  inputBg:     '#f1f5f9',   // fond des champs de saisie
  border:      '#e2e8f0',   // bordures par défaut
  borderLight: '#f1f5f9',   // séparateurs

  // ── Rétrocompatibilité ───────────────────────────────────────────────────
  successLight:  '#dcfce7',
  dangerLight:   '#fef2f2',
  warningLight:  '#fffbeb',
  background:    '#f0f4f8',
};

export const Shadow = {
  card: {
    shadowColor:  '#0f172a' as const,
    shadowOpacity: 0.07,
    shadowRadius:  8,
    shadowOffset:  { width: 0, height: 2 },
    elevation: 3,
  },
  elevated: {
    shadowColor:  '#0f172a' as const,
    shadowOpacity: 0.12,
    shadowRadius:  14,
    shadowOffset:  { width: 0, height: 4 },
    elevation: 6,
  },
};

export const Radius = {
  sm:   8,
  md:   12,
  lg:   16,
  xl:   20,
  pill: 999,
};

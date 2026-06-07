export const Colors = {
  brandBlue:    '#1a7fba',
  brandOrange:  '#f47920',
  navy:         '#0a1628',

  success:      '#198754',
  danger:       '#dc3545',
  warning:      '#ffc107',
  warningLight: '#fff3cd',
  warningBorder:'#ffc107',
  successLight: '#d1e7dd',
  dangerLight:  '#f8d7da',

  text:         '#1a2332',
  textSub:      '#555',
  textMuted:    '#6c757d',
  textLight:    '#aaa',
  textOnBrand:  '#fff',
  textOnBrandSub: '#d0e8f5',

  background:   '#f5f5f5',
  surface:      '#fff',
  border:       '#e0e0e0',
  borderLight:  '#f0f0f0',
};

export const Shadow = {
  card: {
    shadowColor: '#000' as const,
    shadowOpacity: 0.05,
    shadowRadius: 4,
    shadowOffset: { width: 0, height: 2 },
    elevation: 2,
  },
  elevated: {
    shadowColor: '#000' as const,
    shadowOpacity: 0.1,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 4 },
    elevation: 4,
  },
};

export const Radius = {
  sm:   6,
  md:   10,
  lg:   12,
  xl:   14,
  pill: 999,
};

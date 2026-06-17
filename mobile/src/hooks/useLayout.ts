import { useWindowDimensions } from 'react-native';

/**
 * Hook réactif à la rotation et à la taille de l'écran.
 * Utilisé pour adapter les mises en page téléphone / tablette.
 *
 * Seuils :
 *  - isTablet   : dimension la plus courte ≥ 600dp (7" Android = ~600dp)
 *  - numColumns : largeur ≥ 700dp → 2 colonnes dans les listes
 *  - wide       : largeur ≥ 700dp → contrainte maxWidth sur les formulaires
 */
export interface Layout {
  width: number;
  height: number;
  isLandscape: boolean;
  isTablet: boolean;
  numColumns: number;
  isWide: boolean;
}

export function useLayout(): Layout {
  const { width, height } = useWindowDimensions();
  const isWide = width >= 700;
  return {
    width,
    height,
    isLandscape: width > height,
    isTablet: Math.min(width, height) >= 600,
    numColumns: isWide ? 2 : 1,
    isWide,
  };
}

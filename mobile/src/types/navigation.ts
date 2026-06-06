/**
 * Cartographie des ecrans de l'application.
 * Permet a TypeScript de typer les navigations entre ecrans.
 */

export type RootStackParamList = {
  Login: undefined;
  Dashboard: undefined;
  Programme: { programmeId: number };
  SaisieOperation: { etapeId: number };
  Anomalie: { programmeUuid: string; programmeId: number };
  Cloture: { programmeId: number };
  Debug: undefined;
  EtapeDetail: { etapeId: number; etapeUuid: string };
  MesAnomalies: { programmeUuid: string; programmeNumero: string };
};

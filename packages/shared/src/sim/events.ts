import type { ProductionCategory } from '../data/rules';

/**
 * Ereignisse, die die Simulation meldet – für Meldungen, Effekte und Sounds
 * im Client. Sie verändern den Spielzustand nicht.
 */
export type SimEvent =
  | { type: 'unitCreated'; id: number; owner: number; defId: string }
  | { type: 'unitDied'; id: number; owner: number; defId: string; x: number; y: number; category: string }
  | { type: 'buildingPlaced'; id: number; owner: number; defId: string }
  | { type: 'buildingDestroyed'; id: number; owner: number; defId: string; x: number; y: number; w: number; h: number }
  | { type: 'buildingSold'; id: number; owner: number }
  | { type: 'buildingReady'; owner: number; category: ProductionCategory; defId: string }
  | { type: 'unitReady'; owner: number; defId: string; id: number }
  | { type: 'underAttack'; owner: number; x: number; y: number }
  | { type: 'lowPower'; owner: number }
  | { type: 'storageFull'; owner: number }
  | { type: 'insufficientFunds'; owner: number }
  | { type: 'captured'; id: number; owner: number; previousOwner: number }
  | { type: 'cannotDeploy'; owner: number; x: number; y: number }
  | { type: 'cannotUnload'; owner: number; x: number; y: number }
  | { type: 'boarded'; owner: number; carrierId: number }
  | { type: 'unloaded'; owner: number; carrierId: number; x: number; y: number }
  | { type: 'surfaced'; owner: number; id: number; x: number; y: number }
  | { type: 'fired'; sourceId: number; owner: number; x: number; y: number; weaponId: string }
  | { type: 'impact'; x: number; y: number; weaponId: string; splash: number }
  | { type: 'playerDefeated'; owner: number }
  // Kampagne
  | { type: 'radio'; key: string; speaker: string }
  | { type: 'objective'; id: string; key: string; status: 'open' | 'done' | 'failed' }
  | { type: 'missionEnd'; victory: boolean; reasonKey?: string }
  | { type: 'gameOver'; winners: number[] };

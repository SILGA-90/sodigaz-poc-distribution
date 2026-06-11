export interface TableChanges {
  created: any[];
  updated: any[];
  deleted: string[];
}

export interface PullResponse {
  changes: Record<string, TableChanges>;
  timestamp: number;
}

export interface PullResult {
  success: boolean;
  timestamp: number;
  counts: Record<string, number>;
  error?: string;
}

export interface PushResult {
  success: boolean;
  pushed: { operation: number; ligne_operation: number; anomalie: number };
  error?: string;
}

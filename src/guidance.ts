export interface NextAction {
  tool: string;
  reason: string;
  input?: Record<string, unknown>;
  required_inputs?: string[];
  when?: string;
}


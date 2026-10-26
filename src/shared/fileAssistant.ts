export const ASSISTANT_MODES = ['destination', 'organize', 'project', 'tags', 'application', 'search', 'placement', 'handoff'] as const
export type AssistantMode = typeof ASSISTANT_MODES[number]
export const ASSISTANT_CATEGORIES = ['Documents', 'Invoices', 'Contracts', 'Images', 'Installers', 'Code', 'Media', 'Other'] as const
export const ASSISTANT_MAX_FILES = 50
export interface AssistantOptions { fileAssistantEnabled: boolean; fileAssistantReadContent: boolean }
export interface AssistantRequest {
  folder: string
  paths: string[]
  mode: AssistantMode
  goal: string
  candidates: string[]
  categories: string[]
}
export interface AssistantChoice { id: string; label: string; destination?: string }
export interface AssistantRow {
  path: string
  choice: string
  score: number
  review: boolean
  truncated: boolean
  content: 'metadata' | 'text' | 'unsupported'
  tags: string[]
}
export interface AssistantPlan {
  id: string
  mode: AssistantMode
  folder: string
  choices: AssistantChoice[]
  rows: AssistantRow[]
  omitted: number
  createdAt: number
}
export interface AssistantEdit { path: string; choice: string; selected: boolean }
export interface AssistantApply { planId: string; edits: AssistantEdit[]; operation: 'move' | 'copy' | 'tags' | 'open'; destination?: string }
export interface AssistantApplied { completed: { path: string; destination?: string; tags?: string[] }[]; failed: { path: string; error: string }[] }
export interface AssistantStatus { enabled: boolean; readContent: boolean; ready: boolean; downloading: boolean; progress: number; busy: boolean; done: number; total: number; error: string | null; model: string }
export interface DecisionInput { state: string; question: string; choices: { id: string; description: string }[] }
export interface DecisionOutput { choice: string; score: number; probabilities: number[]; truncated: boolean; collapsed: boolean }
export const LAYA_MODEL = 'onnx-community/laya-multilingual-ONNX'
export const LAYA_REVISION = '46b77bbf5642fec5f14e540570228a8cbe8ab81f'
export const LAYA_ID = `${LAYA_MODEL}:${LAYA_REVISION}:fp32:v1`
export const LAYA_FILES = [
  { file: 'config.json', size: 2859, sha256: 'cc32109b1fded91ec6734127ffb1827f80cdcf8ffdd4eeda75a1b0f4d3687dcc' },
  { file: 'tokenizer_config.json', size: 502, sha256: '424b69444bf7b5809dc2cd2e36d0bd71b8055124dd24274d6db3c655d38205e7' },
  { file: 'tokenizer.json', size: 34363188, sha256: '609d8f4c067cd3950f88594c5a802616cea245823836ef5848ee4fc40aab5b6f' },
  { file: 'onnx/model.onnx', size: 3553251, sha256: '22461d988f675dd6c2b89ff8feb9ed7ffcf7e37854e5ed512f8b275178cf2f9f' },
  { file: 'onnx/model.onnx_data', size: 1287635968, sha256: 'f01238e183ace77661282e4eb2dd9b872c7044cb9678f904cf409e6cc1146d09' }
] as const

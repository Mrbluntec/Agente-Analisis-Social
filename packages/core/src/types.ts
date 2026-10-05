// Alias legibles sobre los tipos generados desde api/openapi.yaml (npm run types).
import type { components } from './schema';

type S = components['schemas'];

export type Network = S['Network'];
export type PostFormat = S['PostFormat'];
export type Period = S['Period'];
export type Kpi = S['Kpi'];
export type Insight = S['Insight'];
export type BrandSummary = S['BrandSummary'];
export type Timeseries = S['Timeseries'];
export type Annotation = S['Annotation'];
export type PostRow = S['PostRow'];
export type PostDetail = S['PostDetail'];
export type Briefing = S['Briefing'];
export type Alert = S['Alert'];
export type Brand = S['Brand'];
export type SocialAccount = S['SocialAccount'];
export type AgentRun = S['AgentRun'];
export type AgentEvent = S['AgentEvent'];
export type AgentQueue = S['AgentQueue'];
export type AgentModel = S['AgentModel'];
export type Conversation = S['Conversation'];
export type Citation = S['Citation'];
export type ToolCall = S['ToolCall'];
export type OllamaKey = S['OllamaKey'];

export const NETWORK_LABEL: Record<Network, string> = {
  instagram: 'Instagram',
  facebook: 'Facebook',
  tiktok: 'TikTok',
  youtube: 'YouTube',
  linkedin: 'LinkedIn',
  x: 'X',
};

export const FORMAT_LABEL: Record<PostFormat, string> = {
  reel: 'Reel',
  carousel: 'Carrusel',
  image: 'Imagen',
  story: 'Historia',
  video: 'Video largo',
  short: 'Short',
  text: 'Texto',
  link: 'Enlace',
};

export const FORMAT_TAG: Record<PostFormat, string> = {
  reel: 'REEL',
  carousel: 'CARR',
  image: 'IMG',
  story: 'HIST',
  video: 'VIDEO',
  short: 'SHORT',
  text: 'TXT',
  link: 'LINK',
};

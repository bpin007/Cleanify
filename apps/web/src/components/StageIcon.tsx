import type { Stage } from '@cleanify/engine';
import {
  CaseSensitive,
  EyeOff,
  Languages,
  ShieldCheck,
  Wrench,
  type LucideIcon,
} from 'lucide-react';
import { STAGE_TEXT } from '../lib/stageStyle';

const ICONS: Record<Stage, LucideIcon> = {
  encoding: Wrench,
  ascii: CaseSensitive,
  invisible: EyeOff,
  translate: Languages,
  safety: ShieldCheck,
};

export function StageIcon({ stage, className = 'size-4' }: { stage: Stage; className?: string }) {
  const Icon = ICONS[stage];
  return <Icon aria-hidden="true" className={`${className} ${STAGE_TEXT[stage]} shrink-0`} />;
}

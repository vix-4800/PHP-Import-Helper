import type * as vscode from 'vscode';
import type { CacheActivityEvent, CacheActivityPhase } from '../types';

export interface StatusBarItemLike {
    text: string;
    tooltip?: vscode.MarkdownString | string;
    show: () => void;
    hide: () => void;
}

function activityLabel(phase: CacheActivityPhase): { label: string; tooltip: string } {
    if (phase === 'update') {
        return {
            label: 'updating cache',
            tooltip: 'PHP Import Helper is updating namespace cache.',
        };
    }

    return {
        label: 'building cache',
        tooltip: 'PHP Import Helper is building namespace cache.',
    };
}

export class CacheStatusBarController {
    public constructor(private readonly item: StatusBarItemLike) {}

    public handleActivity(event: CacheActivityEvent): void {
        if (event.kind === 'end') {
            this.item.hide();
            return;
        }

        const activity = activityLabel(event.phase);
        this.item.text = `$(sync~spin) PHP Import Helper: ${activity.label}`;
        this.item.tooltip = activity.tooltip;
        this.item.show();
    }
}

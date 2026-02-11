/**
 * ABOUTME: MobX store for civilizational theme management.
 * Supports 18 themes with CSS custom property application.
 */

import type { ThemeDefinition } from '@castalia-subset/types';
import type { RootStore } from './RootStore';

export class ThemeStore {
  rootStore: RootStore;
  currentThemeId: string = 'greek-classical';
  themes: ThemeDefinition[] = [];

  constructor(rootStore: RootStore) {
    this.rootStore = rootStore;
  }

  get currentTheme(): ThemeDefinition | undefined {
    return this.themes.find((t) => t.id === this.currentThemeId);
  }

  setTheme(themeId: string): void {
    this.currentThemeId = themeId;
  }

  applyThemeToDOM(): void {
    const theme = this.currentTheme;
    if (!theme) return;
    const root = document.documentElement;
    for (const [key, value] of Object.entries(theme.colors)) {
      root.style.setProperty(`--color-${key}`, value);
    }
  }
}

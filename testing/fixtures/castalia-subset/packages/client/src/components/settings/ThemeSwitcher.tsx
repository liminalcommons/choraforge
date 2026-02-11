/**
 * ABOUTME: Theme switcher component for choosing between civilizational themes.
 * Renders a grid of theme cards with color previews.
 */

import React from 'react';
import type { ThemeDefinition } from '@castalia-subset/types';

interface ThemeSwitcherProps {
  themes: ThemeDefinition[];
  currentThemeId: string;
  onSelect: (themeId: string) => void;
}

export function ThemeSwitcher({ themes, currentThemeId, onSelect }: ThemeSwitcherProps) {
  return (
    <div className="theme-switcher">
      <h3>Choose Theme</h3>
      <div className="theme-grid">
        {themes.map((theme) => (
          <button
            key={theme.id}
            className={`theme-card ${theme.id === currentThemeId ? 'active' : ''}`}
            onClick={() => onSelect(theme.id)}
            aria-pressed={theme.id === currentThemeId}
          >
            <div className="theme-preview">
              <div style={{ backgroundColor: theme.colors.primary }} className="swatch" />
              <div style={{ backgroundColor: theme.colors.secondary }} className="swatch" />
              <div style={{ backgroundColor: theme.colors.accent }} className="swatch" />
            </div>
            <span className="theme-name">{theme.name}</span>
            <span className="theme-civ">{theme.civilization}</span>
          </button>
        ))}
      </div>
    </div>
  );
}

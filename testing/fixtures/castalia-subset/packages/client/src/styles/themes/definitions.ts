/**
 * ABOUTME: Civilizational theme definitions.
 * Subset of 18 themes — includes 3 representative themes for testing.
 */

import type { ThemeDefinition } from '@castalia-subset/types';

export const themes: ThemeDefinition[] = [
  {
    id: 'greek-classical',
    name: 'Classical Athens',
    civilization: 'Greek',
    colors: {
      primary: '#2E4057',
      secondary: '#048A81',
      background: '#F8F4E3',
      surface: '#FFFFFF',
      text: '#1A1A2E',
      accent: '#D4A574',
      zoneAgora: '#048A81',
      zoneGarden: '#6B8E4E',
      zoneAuditorium: '#8B4513',
      zoneTeahouse: '#C19A6B',
    },
  },
  {
    id: 'edo-japan',
    name: 'Edo Period',
    civilization: 'Japanese',
    colors: {
      primary: '#2D1B2E',
      secondary: '#C41E3A',
      background: '#F5F0EB',
      surface: '#FAFAF5',
      text: '#2D1B2E',
      accent: '#FFB347',
      zoneAgora: '#C41E3A',
      zoneGarden: '#3D6B3D',
      zoneAuditorium: '#4A3728',
      zoneTeahouse: '#8B7355',
    },
  },
  {
    id: 'mali-empire',
    name: 'Mali Empire',
    civilization: 'West African',
    colors: {
      primary: '#8B4513',
      secondary: '#DAA520',
      background: '#FFF8DC',
      surface: '#FFFFF0',
      text: '#3E2723',
      accent: '#CD853F',
      zoneAgora: '#DAA520',
      zoneGarden: '#556B2F',
      zoneAuditorium: '#8B4513',
      zoneTeahouse: '#D2691E',
    },
  },
];

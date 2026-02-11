/**
 * ABOUTME: MobX root store aggregating all domain stores.
 * Each sub-store receives the root for cross-store communication.
 */

import { CalendarStore } from './CalendarStore';
import { ThemeStore } from './ThemeStore';
import { NetworkStore } from './NetworkStore';

export class RootStore {
  calendarStore: CalendarStore;
  themeStore: ThemeStore;
  networkStore: NetworkStore;

  constructor() {
    this.calendarStore = new CalendarStore(this);
    this.themeStore = new ThemeStore(this);
    this.networkStore = new NetworkStore(this);
  }
}

let rootStore: RootStore | null = null;

export function getRootStore(): RootStore {
  if (!rootStore) rootStore = new RootStore();
  return rootStore;
}

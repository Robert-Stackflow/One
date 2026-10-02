import { screen } from 'electron';
import {levels} from './levels';
import type { DisplayBrightness } from '../shared/types';
class BrightnessService {
  request(point: { x: number; y: number }, delta?: number): Promise<DisplayBrightness> {
    return levels.request('brightness',point,delta);
  }
  async status(): Promise<DisplayBrightness[]> {
    const results: DisplayBrightness[] = [];
    for (const display of screen.getAllDisplays()) {
      const point = screen.dipToScreenPoint({ x: Math.round(display.bounds.x+display.bounds.width/2), y: Math.round(display.bounds.y+display.bounds.height/2) });
      try { const result = await this.request(point); results.push({ ...result, name: display.label || result.name }); }
      catch (error) { results.push({ name: display.label || `屏幕 ${display.id}`, supported: false, method: '', error: error instanceof Error ? error.message : String(error) }); }
    }
    return results;
  }
  stop() {levels.stop();}
}
export const brightness = new BrightnessService();

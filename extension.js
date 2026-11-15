'use strict';

import { Extension } from 'resource:///org/gnome/shell/extensions/extension.js';

export default class TahoeInputIndicatorExtension extends Extension {
    async enable() {
        try {
            const cacheBuster = Date.now();
            const mod = await import(`file://${this.path}/boing_indicator.js?v=${cacheBuster}`);
            this._impl = new mod.default(this);
            this._impl.enable();
            console.log('[Boing Cloud Input Indicator] Extension enabled');
        } catch (e) {
            console.error('[Boing Cloud Input Indicator] Failed to enable implementation:', e);
        }
    }

    disable() {
        if (this._impl) {
            try {
                this._impl.disable();
            } catch (e) {
                console.error('[Boing Cloud Input Indicator] Error in disable:', e);
            }
            this._impl = null;
        }
        console.log('[Boing Cloud Input Indicator] Extension disabled');
    }
}

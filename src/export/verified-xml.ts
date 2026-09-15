/** Native XPSM supplies table column IDs/enums; live values supply numeric precision.
 * Unsupported/mismatched representations fail closed; the JSON audit is still saved.
 */
const esc = (s: unknown) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&apos;');
const unesc = (s: string) => s.replace(/&(amp|lt|gt|quot|apos);/g, (_, n) => (({amp:'&',lt:'<',gt:'>',quot:'"',apos:"'"} as Record<string, string>)[n] ?? ''));

export function correctNativeXml(xml: string, values: Record<string, any>): { xml: string; corrected: string[] } {
  const corrected: string[] = [];
  const scalar = (tag: string, id: string, native: string | undefined, text: string | undefined, value: any) => {
    if (typeof value === 'number' && !Number.isFinite(value)) throw new Error(`Non-finite ${id}`);
    if (typeof value === 'number' || typeof value === 'boolean') {
      // Symbolic enums are provided by the native serializer. Their IDs are not numeric precision losses.
      if (typeof value === 'number' && native !== undefined && !/^[+-]?(?:\d+\.?\d*|\.\d+)(?:e[+-]?\d+)?$/i.test(native))
        return `<${tag} id="${esc(id)}" value="${esc(native)}"/>`;
      const result = String(value);
      if ((typeof value === "number" ? Number(native) !== value : native !== result)) corrected.push(id);
      return `<${tag} id="${esc(id)}" value="${esc(result)}"/>`;
    }
    if (typeof value === 'string') {
      if (native !== undefined) throw new Error(`Cannot map string attribute ${id}`);
      if (unesc(text ?? '') !== value) corrected.push(id);
      return `<${tag} id="${esc(id)}">${esc(value)}</${tag}>`;
    }
    throw new Error(`Unsupported parameter ${id}`);
  };
  xml = xml.replace(/<parameter id="([^"]+)"(?: value="([^"]*)"\s*\/|>([\s\S]*?)<\/parameter)>/g,
    (_, id, native, text) => {
      if (!Object.prototype.hasOwnProperty.call(values, id)) throw new Error(`Native parameter ${id} has no matching live property (possible alias)`);
      return scalar('parameter', id, native, text, values[id]);
    });
  xml = xml.replace(/<table id="([^"]+)" rows="(\d+)"(?:\s*\/|>([\s\S]*?)<\/table)>/g,
    (_, id, rows, body = '') => {
      const arr = values[id];
      if (!Array.isArray(arr) || arr.length !== Number(rows)) throw new Error(`Table ${id} shape differs from live values`);
      let ri = 0;
      const result = body.replace(/<tr>([\s\S]*?)<\/tr>/g, (_: string, row: string) => {
        const liveRow = arr[ri++];
        if (!Array.isArray(liveRow)) throw new Error(`Unsupported table row ${id}`);
        let ci = 0;
        const cells = row.replace(/<td id="([^"]+)"(?: value="([^"]*)"\s*\/|>([\s\S]*?)<\/td)>/g,
          (_: string, col: string, native: string, text: string) => scalar('td', col, native, text, liveRow[ci++]));
        if (ci !== liveRow.length) throw new Error(`Table ${id} column count mismatch`);
        return `<tr>${cells}</tr>`;
      });
      if (ri !== arr.length) throw new Error(`Table ${id} row count mismatch`);
      return `<table id="${esc(id)}" rows="${rows}">${result}</table>`;
    });
  return { xml, corrected };
}

export function buildVerifiedContainer(history: any, iconName: string, fromIndex = 0, toIndex?: number) {
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(iconName)) throw new Error('iconName must be a PixInsight identifier');
  const end = toIndex ?? Math.min(history.source.historyIndex, history.steps.length);
  if (fromIndex < 0 || end > history.steps.length || end <= fromIndex) throw new Error('Invalid or empty history slice');
  const steps = history.steps.slice(fromIndex, end);
  const corrected: any[] = [];
  const instances = steps.map((step: any) => {
    if (Object.keys(step.parameters.unreadable).length) throw new Error(`Unreadable live parameters in ${step.processId}`);
    if (step.processId === 'ProcessContainer') throw new Error('Nested containers require separate export; raw history JSON retained');
    const fixed = correctNativeXml(step.nativeXml, step.parameters.values);
    corrected.push({ containerIndex: step.containerIndex, parameters: fixed.corrected });
    // Native serialization supplies correct process version/schema. Container entry
    // attributes carry the historical enabled/mask state.
    return fixed.xml.replace(/<instance\b([^>]*)>/, (_, attrs: string) => {
      attrs = attrs.replace(/\s+(?:id|enabled)="[^"]*"/g, "");
      return `<instance${attrs} enabled="${step.enabled}">${step.maskId ? `\n<mask id="${esc(step.maskId)}" inverted="${step.maskInverted}" deleted="false"/>` : ''}`;
    });
  });
  const xml = `<?xml version="1.0" encoding="UTF-8"?>\n<xpsm version="1.0" xmlns="http://www.pixinsight.com/xpsm">\n<instance class="ProcessContainer" id="${iconName}_instance">\n${instances.join('\n')}\n</instance>\n<icon id="${iconName}" instance="${iconName}_instance" xpos="16" ypos="16" workspace="Workspace01"/>\n</xpsm>\n`;
  return { xml, corrected, fromIndex, toIndex: end, processes: steps.map((s: any) => s.processId) };
}

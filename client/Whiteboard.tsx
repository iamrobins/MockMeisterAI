import { useEffect, useRef } from 'react';
import { Excalidraw, exportToBlob } from '@excalidraw/excalidraw';
import '@excalidraw/excalidraw/index.css';

type Props = { sessionId?: string; sessionHandle?: string; active: boolean; notice: (message: string) => void; boardStatus: (message: string) => void };

export function Whiteboard({ sessionId, sessionHandle, active, notice, boardStatus }: Props) {
  const latest = useRef<readonly unknown[]>([]); const signature = useRef(''); const version = useRef(0); const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined); const lastSent = useRef(0); const capturing = useRef(false);
  useEffect(() => () => clearTimeout(timer.current), []);
  function queueCapture() {
    clearTimeout(timer.current);
    timer.current = setTimeout(() => { void capture().catch(() => notice('The latest drawing could not be captured.')); }, Math.max(1_500, 5_000 - (Date.now() - lastSent.current)));
  }
  async function capture() {
    if (!active || !sessionId || !sessionHandle || capturing.current) return;
    const capturedSignature = signature.current;
    const elements = [...latest.current] as any;
    capturing.current = true;
    try {
      const blob = await exportToBlob({ elements, appState: { exportBackground: true }, files: null, getDimensions: () => ({ width: 1600, height: 1600, scale: 1 }) });
      const pngBase64 = await new Promise<string>((resolve, reject) => { const reader = new FileReader(); reader.onerror = () => reject(reader.error); reader.onload = () => resolve(String(reader.result).split(',', 2)[1]); reader.readAsDataURL(blob); });
      const response = await fetch(`/api/sessions/${sessionId}/board`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Interview-Session': sessionHandle }, body: JSON.stringify({ version: ++version.current, capturedAt: new Date().toISOString(), elements, pngBase64 }) });
      if (!response.ok) notice('The latest drawing was not saved for this interview.');
      else boardStatus('Checking board…');
      lastSent.current = Date.now();
    } finally {
      capturing.current = false;
      if (signature.current !== capturedSignature) queueCapture();
    }
  }
  return <div className="whiteboard"><Excalidraw onChange={(elements) => {
    latest.current = elements;
    const next = JSON.stringify(elements.map((element: any) => [element.id, element.version, element.versionNonce, element.isDeleted]));
    if (next === signature.current) return;
    signature.current = next;
    queueCapture();
  }} /></div>;
}

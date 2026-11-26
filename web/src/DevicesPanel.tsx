import QRCode from 'qrcode';
import { useCallback, useEffect, useRef, useState } from 'react';
import { api, ApiError } from './api';
import { mmss, phoneUrl } from './phone';
import type { Device, PhoneInfo } from './types';

interface Pairing {
  link: string;
  qr: string; // a data: URL image (allowed by the page's Content-Security-Policy)
  via: 'tailscale' | 'wifi';
  url: string;
  expiresAt: number;
}

const describeError = (err: unknown) => (err instanceof ApiError ? `${err.message}${err.hint ? ` ${err.hint}` : ''}` : String(err));

/**
 * Phones & devices: connect a phone with a QR code, see every signed-in browser, and remove
 * one in a click. Pairing and removing others work only on the computer running the
 * assistant; a phone sees the list and can sign itself out.
 */
export function DevicesPanel({ onClose, onSignedOut, autoPair = false }: { onClose(): void; onSignedOut(): void; autoPair?: boolean }) {
  const [info, setInfo] = useState<PhoneInfo | null>(null);
  const [devices, setDevices] = useState<Device[]>([]);
  const [pairing, setPairing] = useState<Pairing | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [now, setNow] = useState(Date.now());

  const load = useCallback(async () => {
    try {
      const [i, d] = await Promise.all([api.phoneInfo(), api.devices()]);
      setInfo(i);
      setDevices(d.data);
    } catch (err) {
      setError(describeError(err));
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  // The countdown, and a refresh of the list (a phone that just scanned appears).
  useEffect(() => {
    if (!pairing) return;
    const tick = setInterval(() => setNow(Date.now()), 1000);
    const refresh = setInterval(() => void api.devices().then((d) => setDevices(d.data), () => {}), 4000);
    return () => {
      clearInterval(tick);
      clearInterval(refresh);
    };
  }, [pairing]);

  const connect = async () => {
    setError(null);
    const target = info && phoneUrl(info);
    if (!target) return;
    try {
      const { code, expiresAt } = await api.pairCode();
      const link = `${target.url}/#code=${code}`;
      const qr = await QRCode.toDataURL(link, { margin: 1, width: 240 });
      setPairing({ link, qr, via: target.via, url: target.url, expiresAt: Date.parse(expiresAt) });
      setNow(Date.now());
    } catch (err) {
      setError(describeError(err));
    }
  };

  // Opened by `llm phone --browser`: show the QR code at once (once, even under StrictMode).
  const autoPaired = useRef(false);
  useEffect(() => {
    if (!autoPair || autoPaired.current || !info?.canPair || !phoneUrl(info)) return;
    autoPaired.current = true;
    void connect();
  }, [autoPair, info]); // connect() reads `info`, so this runs again once it has loaded

  const remove = async (d: Device) => {
    const label = d.current ? 'Sign out this browser?' : `Remove ${d.deviceName ?? 'this device'}? It is signed out at once.`;
    if (!confirm(label)) return;
    try {
      await api.removeDevice(d.id);
      if (d.current) return onSignedOut();
      await load();
    } catch (err) {
      setError(describeError(err));
    }
  };

  const target = info && phoneUrl(info);
  const expired = pairing !== null && now >= pairing.expiresAt;

  return (
    <div className="overlay" role="dialog" aria-modal="true" aria-labelledby="devices-title">
      <div className="panel">
        <header className="panel-header">
          <h2 id="devices-title">Phones &amp; devices</h2>
          <button type="button" className="ghost" onClick={onClose} aria-label="Close">×</button>
        </header>

        {error && <p className="panel-error" role="alert">{error}</p>}

        {info?.canPair && (
          <section className="pair">
            <h3>Connect a phone</h3>
            {!target && (
              <div className="muted">
                <p>Phones can't reach the assistant yet. Choose one:</p>
                <ul>
                  <li><strong>Same Wi-Fi</strong> (at home; not encrypted): stop the assistant and start it with <code>llm start --phone</code>.</li>
                  <li>
                    <strong>Anywhere, encrypted:</strong> Tailscale on this computer and your phone, then{' '}
                    <code>tailscale serve --bg {location.port || '80'}</code>.
                    {info.tailscale.name && <> Tailscale is installed here ({info.tailscale.name}).</>}
                  </li>
                </ul>
                <button type="button" className="ghost" onClick={() => void load()}>Check again</button>
              </div>
            )}
            {target && !pairing && (
              <button type="button" className="primary" onClick={() => void connect()}>Show a QR code</button>
            )}
            {target && pairing && (
              <div className="qr">
                {expired ? (
                  <p className="muted">This code has expired.</p>
                ) : (
                  <>
                    <img src={pairing.qr} alt="QR code to connect a phone" width={240} height={240} />
                    <p>Scan with your phone's camera. Works once, for <strong>{mmss(pairing.expiresAt - now)}</strong>.</p>
                    <p className="muted small">
                      {pairing.via === 'tailscale' ? 'Through Tailscale: encrypted, works anywhere.' : 'Same Wi-Fi only; the connection is not encrypted.'}{' '}
                      {pairing.url}
                    </p>
                  </>
                )}
                <button type="button" className="ghost" onClick={() => void connect()}>New code</button>
              </div>
            )}
          </section>
        )}

        <section>
          <h3>Signed in</h3>
          <ul className="devices">
            {devices.map((d) => (
              <li key={d.id}>
                <div>
                  <strong>{d.deviceName ?? 'Browser'}</strong>
                  {d.current && <span className="tag">this one</span>}
                  <div className="muted small">
                    {d.createdFrom === 'local' ? 'This computer' : 'Paired device'} · last used {new Date(d.lastSeenAt).toLocaleString()}
                  </div>
                </div>
                {(info?.canPair || d.current) && (
                  <button type="button" className="ghost danger" onClick={() => void remove(d)}>
                    {d.current ? 'Sign out' : 'Remove'}
                  </button>
                )}
              </li>
            ))}
            {devices.length === 0 && <li className="muted">Nothing signed in.</li>}
          </ul>
          {!info?.canPair && <p className="muted small">Connect or remove other devices on the computer running the assistant.</p>}
        </section>
      </div>
    </div>
  );
}

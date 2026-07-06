import { useEffect, useRef, useState } from "react";
import { X } from "lucide-react";
import { Button } from "@/components/ui/button";

/** Tarayıcı yerlisi BarcodeDetector ile kamera üzerinden barkod/QR okur.
 * API yoksa (Safari/Firefox) dürüst bir açıklama gösterir — harici WASM
 * çözücü paketlemek yerine platform desteğine yaslanıyoruz (Chrome/Edge).
 */

interface BarcodeDetectorLike {
  detect(source: CanvasImageSource): Promise<{ rawValue: string }[]>;
}

const getDetector = (): BarcodeDetectorLike | null => {
  const ctor = (
    window as unknown as {
      BarcodeDetector?: new (opts?: { formats?: string[] }) => BarcodeDetectorLike;
    }
  ).BarcodeDetector;
  if (!ctor) return null;
  try {
    return new ctor({
      formats: ["ean_13", "ean_8", "code_128", "code_39", "qr_code", "upc_a"],
    });
  } catch {
    return null;
  }
};

export function BarcodeScanner({
  onDetect,
  onClose,
}: {
  onDetect: (code: string) => void;
  onClose: () => void;
}) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [error, setError] = useState<string | null>(null);
  const [supported] = useState(() => getDetector() !== null);

  useEffect(() => {
    if (!supported) return;
    const detector = getDetector()!;
    let stream: MediaStream | null = null;
    let timer: ReturnType<typeof setInterval> | null = null;
    let done = false;

    navigator.mediaDevices
      .getUserMedia({ video: { facingMode: "environment" } })
      .then((s) => {
        stream = s;
        if (videoRef.current) {
          videoRef.current.srcObject = s;
          void videoRef.current.play();
        }
        timer = setInterval(async () => {
          const video = videoRef.current;
          if (done || !video || video.readyState < 2) return;
          try {
            const codes = await detector.detect(video);
            if (codes.length > 0 && codes[0].rawValue) {
              done = true;
              onDetect(codes[0].rawValue);
            }
          } catch {
            // tek kare hatası — sıradaki denemede düzelir
          }
        }, 350);
      })
      .catch(() => setError("Kameraya erişilemedi — tarayıcı izinlerini kontrol edin."));

    return () => {
      done = true;
      if (timer) clearInterval(timer);
      stream?.getTracks().forEach((t) => t.stop());
    };
  }, [supported, onDetect]);

  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-ink-950/80 backdrop-blur-sm">
      <div className="w-[min(92vw,480px)] rounded-md border border-ink-600 bg-ink-900 p-4">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-sm font-semibold">Barkod okut</h2>
          <button
            onClick={onClose}
            aria-label="Kapat"
            className="rounded p-1 text-text-muted hover:bg-ink-700 hover:text-text"
          >
            <X size={15} />
          </button>
        </div>
        {!supported ? (
          <p className="py-4 text-[12.5px] text-text-muted">
            Bu tarayıcı yerleşik barkod okuyucuyu (BarcodeDetector API)
            desteklemiyor. Chrome veya Edge ile deneyin; ya da SKU'yu elle girin.
          </p>
        ) : error ? (
          <p className="py-4 text-[12.5px] text-status-high">{error}</p>
        ) : (
          <>
            <div className="relative overflow-hidden rounded border border-ink-600">
              <video ref={videoRef} className="h-64 w-full object-cover" muted playsInline />
              <div className="pointer-events-none absolute inset-x-10 top-1/2 h-0.5 -translate-y-1/2 bg-status-high/70" />
            </div>
            <p className="mt-2 text-center text-[11.5px] text-text-faint">
              Barkodu kırmızı çizgiye hizalayın — otomatik okunur (EAN/Code128/QR).
            </p>
          </>
        )}
        <Button variant="secondary" className="mt-3 w-full" onClick={onClose}>
          Vazgeç
        </Button>
      </div>
    </div>
  );
}

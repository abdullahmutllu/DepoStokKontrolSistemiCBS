import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { Box, CornerDownLeft, Sparkles } from "lucide-react";
import { useAskMutation } from "@/api/endpoints/ai";
import { useWarehousesQuery } from "@/api/endpoints/warehouses";
import { useAppDispatch } from "@/app/hooks";
import { binsHighlighted } from "@/features/three/selectionSlice";
import type { AskResponse } from "@/types";
import { PageHeader } from "@/components/shared/states";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardBody } from "@/components/ui/card";
import { DataTable, THead, Th, Tr, Td, MonoCell } from "@/components/shared/table";
import { apiErrorMessage } from "@/lib/apiError";

const EXAMPLES = [
  "Stoğu 10'un altına düşen ürünler hangileri?",
  "3. koridordaki tüm stok kayıtlarını göster",
  "Depo bazında toplam stok adedi nedir?",
  "Son hareketlerde en çok toplanan ürünler",
];

export function AskPage() {
  const [question, setQuestion] = useState("");
  const [result, setResult] = useState<AskResponse | null>(null);
  const [ask, askState] = useAskMutation();
  const warehouses = useWarehousesQuery();
  const dispatch = useAppDispatch();
  const navigate = useNavigate();

  const submit = async (q?: string) => {
    const text = (q ?? question).trim();
    if (!text) return;
    setQuestion(text);
    try {
      const response = await ask({ question: text }).unwrap();
      setResult(response);
    } catch (err) {
      setResult({
        ai_available: false,
        question: text,
        interpretation: null,
        columns: [],
        rows: [],
        location_ids: [],
        error: apiErrorMessage(err as Parameters<typeof apiErrorMessage>[0]),
      });
    }
  };

  const showIn3D = () => {
    if (!result || result.location_ids.length === 0) return;
    dispatch(binsHighlighted(result.location_ids));
    const target = warehouses.data?.[0];
    if (target) navigate(`/warehouses/${target.id}`);
  };

  return (
    <div className="mx-auto max-w-3xl">
      <PageHeader
        title="Asistan"
        description="Depo verinize doğal dille sorun; yanıt güvenli, sadece sizin organizasyonunuzla sınırlı bir sorguya çevrilir."
      />

      <div className="flex gap-2">
        <div className="relative flex-1">
          <Sparkles size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-text-faint" />
          <Input
            value={question}
            onChange={(e) => setQuestion(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && void submit()}
            placeholder="Örn. stoğu 10'un altına düşen ürünler…"
            className="pl-8"
            aria-label="Soru"
          />
        </div>
        <Button onClick={() => void submit()} disabled={askState.isLoading}>
          {askState.isLoading ? "Çevriliyor…" : (
            <>
              Sor <CornerDownLeft size={13} />
            </>
          )}
        </Button>
      </div>

      {!result && (
        <div className="mt-4 flex flex-wrap gap-2">
          {EXAMPLES.map((ex) => (
            <button
              key={ex}
              onClick={() => void submit(ex)}
              className="rounded-full border border-ink-600 bg-ink-800 px-3 py-1 text-[12px] text-text-muted transition-colors hover:border-accent hover:text-text"
            >
              {ex}
            </button>
          ))}
        </div>
      )}

      {result && (
        <Card className="mt-4">
          <CardBody className="space-y-3">
            {result.interpretation && (
              <p className="text-[12.5px] text-text-muted">
                <span className="font-medium text-text">Yorum:</span> {result.interpretation}
              </p>
            )}

            {result.error ? (
              <div className="rounded border border-status-mid/40 bg-status-mid/10 px-3 py-2 text-[13px]">
                {result.error}
                {!result.ai_available && (
                  <p className="mt-1 text-[11.5px] text-text-muted">
                    AI kapalıysa .env dosyasına OPENROUTER_API_KEY ekleyin; uygulamanın geri
                    kalanı AI olmadan da tam çalışır.
                  </p>
                )}
              </div>
            ) : result.rows.length === 0 ? (
              <p className="py-2 text-[13px] text-text-muted">
                Sorgu çalıştı, eşleşen kayıt yok.
              </p>
            ) : (
              <>
                <DataTable>
                  <THead>
                    {result.columns.map((c) => (
                      <Th key={c}>{c.replaceAll("_", " ")}</Th>
                    ))}
                  </THead>
                  <tbody>
                    {result.rows.map((row, i) => (
                      <Tr key={i}>
                        {result.columns.map((c) => {
                          const value = row[c];
                          const isNumeric = typeof value === "number";
                          return (
                            <Td key={c}>
                              {isNumeric || c === "sku" || c.includes("code") ? (
                                <MonoCell>{String(value ?? "—")}</MonoCell>
                              ) : (
                                String(value ?? "—")
                              )}
                            </Td>
                          );
                        })}
                      </Tr>
                    ))}
                  </tbody>
                </DataTable>
                <div className="flex items-center justify-between">
                  <span className="mono text-[11.5px] text-text-faint">
                    {result.rows.length} kayıt
                  </span>
                  {result.location_ids.length > 0 && (
                    <Button variant="secondary" size="sm" onClick={showIn3D}>
                      <Box size={13} /> 3B'de göster ({result.location_ids.length} göz)
                    </Button>
                  )}
                </div>
              </>
            )}
          </CardBody>
        </Card>
      )}
    </div>
  );
}

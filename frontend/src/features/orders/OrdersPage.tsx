import { useMemo, useState } from "react";
import { toast } from "sonner";
import { ClipboardList, Package, Plus, Printer, Trash2, Waves, X } from "lucide-react";
import {
  useCreateOrderMutation,
  useMarkOrderPickedMutation,
  useOrdersQuery,
  useWavePickMutation,
} from "@/api/endpoints/logistics";
import { useProductsQuery } from "@/api/endpoints/products";
import { useWarehousesQuery } from "@/api/endpoints/warehouses";
import { PageHeader, EmptyState, LoadingRows } from "@/components/shared/states";
import { Card, CardBody, CardHeader, CardTitle } from "@/components/ui/card";
import { DataTable, THead, Th, Tr, Td, MonoCell } from "@/components/shared/table";
import { Button } from "@/components/ui/button";
import { Input, Select } from "@/components/ui/input";
import { InfoHint } from "@/components/ui/InfoHint";
import { apiErrorMessage } from "@/lib/apiError";
import type { WavePick } from "@/types";

const STATUS_CHIP: Record<string, { label: string; cls: string }> = {
  open: { label: "Açık", cls: "bg-accent/15 text-accent" },
  waved: { label: "Dalgada", cls: "bg-status-mid/15 text-status-mid" },
  picked: { label: "Toplandı", cls: "bg-status-low/15 text-status-low" },
};

const POLICY_LABELS: Record<string, string> = {
  s_shape: "S-shape",
  largest_gap: "Largest-gap",
  optimized: "Optimize",
};

interface DraftLine {
  product_id: number | "";
  quantity: string;
}

export function OrdersPage() {
  const orders = useOrdersQuery();
  const products = useProductsQuery({ page_size: 200 });
  const warehouses = useWarehousesQuery();
  const [createOrder, createState] = useCreateOrderMutation();
  const [wavePick, waveState] = useWavePickMutation();
  const [markPicked] = useMarkOrderPickedMutation();

  const [selected, setSelected] = useState<number[]>([]);
  const [wave, setWave] = useState<WavePick | null>(null);
  const [creating, setCreating] = useState(false);
  const [customerName, setCustomerName] = useState("");
  const [warehouseId, setWarehouseId] = useState<number | "">("");
  const [lines, setLines] = useState<DraftLine[]>([{ product_id: "", quantity: "" }]);

  const openOrders = useMemo(
    () => (orders.data ?? []).filter((o) => o.status === "open"),
    [orders.data],
  );

  const toggle = (id: number) =>
    setSelected((s) => (s.includes(id) ? s.filter((x) => x !== id) : [...s, id]));

  const submitOrder = async () => {
    const validLines = lines
      .filter((l) => l.product_id !== "" && Number(l.quantity) > 0)
      .map((l) => ({ product_id: Number(l.product_id), quantity: Number(l.quantity) }));
    if (!customerName.trim() || warehouseId === "" || validLines.length === 0) {
      toast.error("Müşteri adı, depo ve en az bir geçerli satır gerekli.");
      return;
    }
    try {
      const created = await createOrder({
        warehouse_id: Number(warehouseId),
        customer_name: customerName.trim(),
        lines: validLines,
      }).unwrap();
      toast.success(`${created.code} oluşturuldu`);
      setCreating(false);
      setCustomerName("");
      setLines([{ product_id: "", quantity: "" }]);
    } catch (err) {
      toast.error(apiErrorMessage(err as Parameters<typeof apiErrorMessage>[0]));
    }
  };

  const runWave = async () => {
    try {
      const result = await wavePick({ order_ids: selected }).unwrap();
      setWave(result);
      setSelected([]);
    } catch (err) {
      toast.error(apiErrorMessage(err as Parameters<typeof apiErrorMessage>[0]));
    }
  };

  return (
    <div>
      <PageHeader
        title="Siparişler"
        description="Siparişleri dalga halinde birleştirin; toplama listesi ve optimize rota tek adımda çıkar."
      />

      <div className="mb-3 flex flex-wrap items-center gap-2">
        <Button onClick={() => setCreating(true)}>
          <Plus size={14} /> Sipariş oluştur
        </Button>
        <Button
          variant="secondary"
          disabled={selected.length === 0 || waveState.isLoading}
          onClick={() => void runWave()}
        >
          <Waves size={14} />
          {waveState.isLoading ? "Toplanıyor…" : `Dalga topla (${selected.length})`}
        </Button>
        <InfoHint text="Birden çok siparişi tek turda topla. Aynı ürünler birleşir, gözlere dağıtılır ve en kısa yürüme rotası çıkar; depoda tek sefer dolaşırsın." />
        {openOrders.length > 0 && selected.length === 0 && (
          <span className="text-[12px] text-text-faint">
            Açık siparişleri işaretleyip tek dalgada toplayın.
          </span>
        )}
      </div>

      {/* Sipariş listesi */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-1.5">
            <ClipboardList size={14} /> Sipariş listesi
          </CardTitle>
        </CardHeader>
        <CardBody>
          {orders.isLoading ? (
            <LoadingRows rows={4} />
          ) : !orders.data || orders.data.length === 0 ? (
            <EmptyState
              title="Henüz sipariş yok"
              hint="'Sipariş oluştur' ile başlayın — demo verisinde örnek siparişler de gelir."
            />
          ) : (
            <DataTable>
              <THead>
                <Th className="w-8"> </Th>
                <Th>Kod</Th>
                <Th>Müşteri</Th>
                <Th>Kalemler</Th>
                <Th>Durum</Th>
                <Th className="text-right">İşlem</Th>
              </THead>
              <tbody>
                {orders.data.map((o) => (
                  <Tr key={o.id}>
                    <Td>
                      <input
                        type="checkbox"
                        aria-label={`${o.code} seç`}
                        disabled={o.status !== "open"}
                        checked={selected.includes(o.id)}
                        onChange={() => toggle(o.id)}
                        className="accent-[#5e8bff]"
                      />
                    </Td>
                    <Td><MonoCell>{o.code}</MonoCell></Td>
                    <Td>{o.customer_name}</Td>
                    <Td className="max-w-72 truncate text-[12px] text-text-muted">
                      {o.lines.map((l) => `${l.sku}×${l.quantity}`).join(", ")}
                    </Td>
                    <Td>
                      <span
                        className={`rounded-full px-2 py-0.5 text-[10.5px] font-medium ${STATUS_CHIP[o.status].cls}`}
                      >
                        {STATUS_CHIP[o.status].label}
                      </span>
                    </Td>
                    <Td className="text-right">
                      {o.status === "waved" && (
                        <Button variant="ghost" size="sm" onClick={() => void markPicked(o.id)}>
                          <Package size={12} /> Toplandı
                        </Button>
                      )}
                    </Td>
                  </Tr>
                ))}
              </tbody>
            </DataTable>
          )}
        </CardBody>
      </Card>

      {/* Dalga sonucu — yazdırılabilir toplama listesi */}
      {wave && (
        <Card className="mt-4 print:border-0" data-testid="wave-result">
          <CardHeader className="print:hidden">
            <CardTitle className="flex items-center gap-1.5">
              <Waves size={14} /> Dalga toplama listesi ({wave.order_ids.length} sipariş)
            </CardTitle>
            <div className="flex gap-1.5">
              <Button variant="secondary" size="sm" onClick={() => window.print()}>
                <Printer size={12} /> Yazdır
              </Button>
              <Button variant="ghost" size="sm" onClick={() => setWave(null)}>
                <X size={12} />
              </Button>
            </div>
          </CardHeader>
          <CardBody>
            {wave.route && (
              <p className="mb-2 text-[12.5px] text-text-muted">
                Rota:{" "}
                <span className="mono text-accent">
                  {POLICY_LABELS[wave.route.best_policy]}
                </span>{" "}
                —{" "}
                <span className="mono">
                  {wave.route.routes.find((r) => r.policy === wave.route!.best_policy)?.total_m}{" "}
                  m
                </span>{" "}
                yürüme · {wave.lines.length} kalem · gözler toplama sırasına göre 3B'de de
                çizilebilir.
              </p>
            )}
            <DataTable>
              <THead>
                <Th>SKU</Th>
                <Th>Ürün</Th>
                <Th>Göz</Th>
                <Th className="text-right">Miktar</Th>
              </THead>
              <tbody>
                {wave.lines.map((l) => (
                  <Tr key={l.product_id}>
                    <Td><MonoCell>{l.sku}</MonoCell></Td>
                    <Td>{l.product_name}</Td>
                    <Td>
                      {l.location_code ? (
                        <MonoCell>{l.location_code}</MonoCell>
                      ) : (
                        <span className="text-status-high">stok yok</span>
                      )}
                    </Td>
                    <Td className="text-right"><MonoCell>{l.total_quantity}</MonoCell></Td>
                  </Tr>
                ))}
              </tbody>
            </DataTable>
          </CardBody>
        </Card>
      )}

      {/* Sipariş oluşturma */}
      {creating && (
        <div className="fixed inset-0 z-50 grid place-items-center bg-ink-950/70 backdrop-blur-sm">
          <div className="w-[min(94vw,520px)] rounded-md border border-ink-600 bg-ink-900 p-4">
            <div className="mb-3 flex items-center justify-between">
              <h2 className="text-sm font-semibold">Yeni sipariş</h2>
              <button
                onClick={() => setCreating(false)}
                aria-label="Kapat"
                className="rounded p-1 text-text-muted hover:bg-ink-700"
              >
                <X size={15} />
              </button>
            </div>
            <div className="space-y-2.5">
              <Input
                placeholder="Müşteri adı"
                value={customerName}
                onChange={(e) => setCustomerName(e.target.value)}
                aria-label="Müşteri adı"
              />
              <Select
                value={warehouseId}
                onChange={(e) => setWarehouseId(Number(e.target.value))}
                aria-label="Depo"
              >
                <option value="">Depo seçin…</option>
                {(warehouses.data ?? []).map((w) => (
                  <option key={w.id} value={w.id}>
                    {w.name}
                  </option>
                ))}
              </Select>
              {lines.map((line, i) => (
                <div key={i} className="flex gap-1.5">
                  <Select
                    value={line.product_id}
                    onChange={(e) =>
                      setLines((ls) =>
                        ls.map((l, j) =>
                          j === i ? { ...l, product_id: Number(e.target.value) } : l,
                        ),
                      )
                    }
                    aria-label={`Satır ${i + 1} ürün`}
                    className="flex-1"
                  >
                    <option value="">Ürün…</option>
                    {(products.data?.items ?? []).map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.sku} — {p.name}
                      </option>
                    ))}
                  </Select>
                  <Input
                    type="number"
                    min={1}
                    placeholder="adet"
                    value={line.quantity}
                    onChange={(e) =>
                      setLines((ls) =>
                        ls.map((l, j) => (j === i ? { ...l, quantity: e.target.value } : l)),
                      )
                    }
                    aria-label={`Satır ${i + 1} miktar`}
                    className="w-24"
                  />
                  {lines.length > 1 && (
                    <button
                      onClick={() => setLines((ls) => ls.filter((_, j) => j !== i))}
                      aria-label={`Satır ${i + 1} sil`}
                      className="rounded p-1.5 text-text-faint hover:text-status-high"
                    >
                      <Trash2 size={13} />
                    </button>
                  )}
                </div>
              ))}
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setLines((ls) => [...ls, { product_id: "", quantity: "" }])}
              >
                <Plus size={12} /> Satır ekle
              </Button>
              <Button
                className="w-full"
                onClick={() => void submitOrder()}
                disabled={createState.isLoading}
              >
                {createState.isLoading ? "Kaydediliyor…" : "Siparişi kaydet"}
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

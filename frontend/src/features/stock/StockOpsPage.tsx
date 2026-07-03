import { useMemo, useState } from "react";
import { toast } from "sonner";
import { Sparkles } from "lucide-react";
import { useProductsQuery } from "@/api/endpoints/products";
import { useWarehousesQuery, useLocationsQuery } from "@/api/endpoints/warehouses";
import {
  useAdjustMutation,
  usePickMutation,
  useReceiveMutation,
  useTransferMutation,
} from "@/api/endpoints/stock";
import { useSlottingMutation } from "@/api/endpoints/ai";
import { PageHeader } from "@/components/shared/states";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { Input, Select } from "@/components/ui/input";
import { Card, CardBody } from "@/components/ui/card";
import { MonoCell } from "@/components/shared/table";
import { apiErrorMessage } from "@/lib/apiError";

type OpType = "receive" | "pick" | "transfer" | "adjust";

export function StockOpsPage() {
  const [op, setOp] = useState<OpType>("receive");
  const [warehouseId, setWarehouseId] = useState<number | "">("");
  const [productId, setProductId] = useState<number | "">("");
  const [locationId, setLocationId] = useState<number | "">("");
  const [toLocationId, setToLocationId] = useState<number | "">("");
  const [quantity, setQuantity] = useState("");
  const [note, setNote] = useState("");

  const warehouses = useWarehousesQuery();
  const products = useProductsQuery({ page: 1, page_size: 200 });
  const locations = useLocationsQuery(
    { warehouseId: Number(warehouseId), type: "bin" },
    { skip: warehouseId === "" },
  );

  const [receive, receiveState] = useReceiveMutation();
  const [pick, pickState] = usePickMutation();
  const [transfer, transferState] = useTransferMutation();
  const [adjust, adjustState] = useAdjustMutation();
  const [slotting, slottingState] = useSlottingMutation();

  const busy =
    receiveState.isLoading || pickState.isLoading || transferState.isLoading || adjustState.isLoading;

  const bins = useMemo(() => locations.data ?? [], [locations.data]);

  const reset = () => {
    setQuantity("");
    setNote("");
  };

  const submit = async () => {
    if (productId === "" || locationId === "" || quantity === "") {
      toast.error("Ürün, göz ve miktar seçin.");
      return;
    }
    const qty = Number(quantity);
    const base = { product_id: Number(productId), quantity: qty, note: note || undefined };
    try {
      if (op === "receive") {
        await receive({ ...base, location_id: Number(locationId) }).unwrap();
        toast.success("Mal kabul işlendi");
      } else if (op === "pick") {
        await pick({ ...base, location_id: Number(locationId) }).unwrap();
        toast.success("Toplama işlendi");
      } else if (op === "transfer") {
        if (toLocationId === "") {
          toast.error("Hedef göz seçin.");
          return;
        }
        await transfer({
          ...base,
          from_location_id: Number(locationId),
          to_location_id: Number(toLocationId),
        }).unwrap();
        toast.success("Transfer işlendi");
      } else {
        await adjust({
          product_id: Number(productId),
          location_id: Number(locationId),
          new_quantity: qty,
          note: note || undefined,
        }).unwrap();
        toast.success("Sayım düzeltmesi işlendi");
      }
      reset();
    } catch (err) {
      toast.error(apiErrorMessage(err as Parameters<typeof apiErrorMessage>[0]));
    }
  };

  const suggestSlot = async () => {
    if (productId === "" || warehouseId === "") {
      toast.error("Öneri için ürün ve depo seçin.");
      return;
    }
    try {
      const result = await slotting({
        product_id: Number(productId),
        warehouse_id: Number(warehouseId),
      }).unwrap();
      if (result.suggestions.length === 0) {
        toast.info(result.explanation);
        return;
      }
      const best = result.suggestions[0];
      setLocationId(best.location_id);
      toast.success(`Önerilen göz: ${best.code} — ${best.reason}`, { duration: 6000 });
    } catch (err) {
      toast.error(apiErrorMessage(err as Parameters<typeof apiErrorMessage>[0]));
    }
  };

  const opLabels: Record<OpType, { title: string; verb: string; qtyLabel: string }> = {
    receive: { title: "Mal Kabul", verb: "Mal kabul et", qtyLabel: "Miktar" },
    pick: { title: "Toplama", verb: "Topla", qtyLabel: "Miktar" },
    transfer: { title: "Transfer", verb: "Transfer et", qtyLabel: "Miktar" },
    adjust: { title: "Sayım / Düzeltme", verb: "Miktarı kaydet", qtyLabel: "Yeni miktar" },
  };

  return (
    <div>
      <PageHeader
        title="Stok İşlemleri"
        description="Her işlem hareket kaydı üretir; negatif stok sistem tarafından reddedilir."
      />

      <Tabs value={op} onValueChange={(v) => setOp(v as OpType)}>
        <TabsList>
          <TabsTrigger value="receive">Mal Kabul</TabsTrigger>
          <TabsTrigger value="pick">Toplama</TabsTrigger>
          <TabsTrigger value="transfer">Transfer</TabsTrigger>
          <TabsTrigger value="adjust">Sayım</TabsTrigger>
        </TabsList>

        {(["receive", "pick", "transfer", "adjust"] as const).map((tab) => (
          <TabsContent key={tab} value={tab}>
            <Card className="max-w-xl">
              <CardBody className="space-y-3">
                <div>
                  <label htmlFor="op-product" className="mb-1 block text-[12px] text-text-muted">
                    Ürün
                  </label>
                  <Select
                    id="op-product"
                    value={productId}
                    onChange={(e) => setProductId(e.target.value ? Number(e.target.value) : "")}
                  >
                    <option value="">Ürün seçin…</option>
                    {(products.data?.items ?? []).map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.sku} — {p.name}
                      </option>
                    ))}
                  </Select>
                </div>

                <div>
                  <label htmlFor="op-warehouse" className="mb-1 block text-[12px] text-text-muted">
                    Depo
                  </label>
                  <Select
                    id="op-warehouse"
                    value={warehouseId}
                    onChange={(e) => {
                      setWarehouseId(e.target.value ? Number(e.target.value) : "");
                      setLocationId("");
                      setToLocationId("");
                    }}
                  >
                    <option value="">Depo seçin…</option>
                    {(warehouses.data ?? []).map((w) => (
                      <option key={w.id} value={w.id}>
                        {w.name}
                      </option>
                    ))}
                  </Select>
                </div>

                <div>
                  <div className="mb-1 flex items-center justify-between">
                    <label htmlFor="op-location" className="text-[12px] text-text-muted">
                      {tab === "transfer" ? "Kaynak göz" : "Göz"}
                    </label>
                    {tab === "receive" && (
                      <button
                        type="button"
                        onClick={() => void suggestSlot()}
                        disabled={slottingState.isLoading}
                        className="flex items-center gap-1 text-[11.5px] text-accent hover:underline disabled:opacity-50"
                      >
                        <Sparkles size={11} />
                        {slottingState.isLoading ? "Öneriliyor…" : "Yer önerisi al"}
                      </button>
                    )}
                  </div>
                  <Select
                    id="op-location"
                    value={locationId}
                    onChange={(e) => setLocationId(e.target.value ? Number(e.target.value) : "")}
                    disabled={warehouseId === ""}
                  >
                    <option value="">{warehouseId === "" ? "Önce depo seçin" : "Göz seçin…"}</option>
                    {bins.map((b) => (
                      <option key={b.id} value={b.id}>
                        {b.code}
                      </option>
                    ))}
                  </Select>
                </div>

                {tab === "transfer" && (
                  <div>
                    <label htmlFor="op-target" className="mb-1 block text-[12px] text-text-muted">
                      Hedef göz
                    </label>
                    <Select
                      id="op-target"
                      value={toLocationId}
                      onChange={(e) => setToLocationId(e.target.value ? Number(e.target.value) : "")}
                      disabled={warehouseId === ""}
                    >
                      <option value="">Göz seçin…</option>
                      {bins
                        .filter((b) => b.id !== Number(locationId))
                        .map((b) => (
                          <option key={b.id} value={b.id}>
                            {b.code}
                          </option>
                        ))}
                    </Select>
                  </div>
                )}

                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <label htmlFor="op-qty" className="mb-1 block text-[12px] text-text-muted">
                      {opLabels[tab].qtyLabel}
                    </label>
                    <Input
                      id="op-qty"
                      type="number"
                      min={tab === "adjust" ? 0 : 1}
                      className="mono"
                      value={quantity}
                      onChange={(e) => setQuantity(e.target.value)}
                    />
                  </div>
                  <div>
                    <label htmlFor="op-note" className="mb-1 block text-[12px] text-text-muted">
                      Not (isteğe bağlı)
                    </label>
                    <Input id="op-note" value={note} onChange={(e) => setNote(e.target.value)} />
                  </div>
                </div>

                <Button className="w-full" onClick={() => void submit()} disabled={busy}>
                  {busy ? "İşleniyor…" : opLabels[tab].verb}
                </Button>
              </CardBody>
            </Card>
          </TabsContent>
        ))}
      </Tabs>

      <p className="mt-3 text-[11.5px] text-text-faint">
        İpucu: göz kodu <MonoCell>Z1-A2-R3-S2-B4</MonoCell> = zon 1, koridor 2, raf 3, kat 2, göz 4.
      </p>
    </div>
  );
}

import { useState } from "react";
import { useForm } from "react-hook-form";
import { z } from "zod";
import { zodResolver } from "@hookform/resolvers/zod";
import { toast } from "sonner";
import { useCreateWarehouseMutation } from "@/api/endpoints/warehouses";
import { apiErrorMessage } from "@/lib/apiError";
import type { LatLng } from "@/types";
import { WarehouseMap } from "@/features/warehouses/WarehouseMap";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

const schema = z.object({
  name: z.string().min(1, "Depo adı gerekli"),
  address: z.string().optional(),
  local_width: z.coerce.number().positive("0'dan büyük olmalı").max(2000),
  local_depth: z.coerce.number().positive("0'dan büyük olmalı").max(2000),
});
type FormValues = z.infer<typeof schema>;

export function WarehouseFormDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const [createWarehouse, { isLoading, error }] = useCreateWarehouseMutation();
  const [position, setPosition] = useState<LatLng | null>(null);
  const {
    register,
    handleSubmit,
    reset,
    formState: { errors },
  } = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: { local_width: 40, local_depth: 25 },
  });

  const onSubmit = handleSubmit(async (values) => {
    if (!position) {
      toast.error("Haritaya tıklayarak depo konumunu seçin.");
      return;
    }
    try {
      await createWarehouse({
        name: values.name,
        address: values.address || null,
        location: position,
        local_width: values.local_width,
        local_depth: values.local_depth,
      }).unwrap();
      toast.success("Depo eklendi");
      reset();
      setPosition(null);
      onOpenChange(false);
    } catch {
      // error rendered below
    }
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent title="Depo ekle" className="max-w-2xl">
        <form onSubmit={onSubmit} className="grid grid-cols-1 gap-4 md:grid-cols-2" noValidate>
          <div className="space-y-3">
            <div>
              <label htmlFor="wh-name" className="mb-1 block text-[12px] text-text-muted">
                Depo adı
              </label>
              <Input id="wh-name" placeholder="Örn. İstanbul Ana Depo" {...register("name")} />
              {errors.name && (
                <p className="mt-1 text-[12px] text-status-high">{errors.name.message}</p>
              )}
            </div>
            <div>
              <label htmlFor="wh-address" className="mb-1 block text-[12px] text-text-muted">
                Adres (isteğe bağlı)
              </label>
              <Input id="wh-address" {...register("address")} />
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div>
                <label htmlFor="wh-width" className="mb-1 block text-[12px] text-text-muted">
                  İç genişlik (m)
                </label>
                <Input id="wh-width" type="number" step="0.5" {...register("local_width")} />
                {errors.local_width && (
                  <p className="mt-1 text-[12px] text-status-high">{errors.local_width.message}</p>
                )}
              </div>
              <div>
                <label htmlFor="wh-depth" className="mb-1 block text-[12px] text-text-muted">
                  İç derinlik (m)
                </label>
                <Input id="wh-depth" type="number" step="0.5" {...register("local_depth")} />
                {errors.local_depth && (
                  <p className="mt-1 text-[12px] text-status-high">{errors.local_depth.message}</p>
                )}
              </div>
            </div>
            <p className="text-[12px] text-text-muted">
              Konum: {position ? (
                <span className="mono text-text">
                  {position.lat.toFixed(5)}, {position.lng.toFixed(5)}
                </span>
              ) : (
                "haritaya tıklayın"
              )}
            </p>
            {error && <p className="text-[12px] text-status-high">{apiErrorMessage(error)}</p>}
            <Button type="submit" disabled={isLoading} className="w-full">
              {isLoading ? "Kaydediliyor…" : "Kaydet"}
            </Button>
          </div>
          <div className="h-64 overflow-hidden rounded-md border border-ink-600 md:h-auto">
            <WarehouseMap
              className="h-full w-full"
              onMapClick={setPosition}
              draftMarker={position}
            />
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

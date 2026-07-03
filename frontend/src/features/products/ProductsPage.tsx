import { useRef, useState } from "react";
import { useForm } from "react-hook-form";
import { z } from "zod";
import { zodResolver } from "@hookform/resolvers/zod";
import { toast } from "sonner";
import { Download, FileUp, Pencil, Plus, Search, Trash2 } from "lucide-react";
import {
  useCreateProductMutation,
  useDeleteProductMutation,
  useImportProductsCsvMutation,
  useProductsQuery,
  useUpdateProductMutation,
} from "@/api/endpoints/products";
import type { Product } from "@/types";
import { useAppSelector } from "@/app/hooks";
import { PageHeader, EmptyState, ErrorState, LoadingRows } from "@/components/shared/states";
import { DataTable, THead, Th, Tr, Td, MonoCell, Pagination } from "@/components/shared/table";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { apiErrorMessage } from "@/lib/apiError";

const schema = z.object({
  sku: z.string().min(1, "SKU gerekli"),
  name: z.string().min(1, "Ürün adı gerekli"),
  unit: z.string().min(1, "Birim gerekli"),
  barcode: z.string().optional(),
  description: z.string().optional(),
  min_stock_threshold: z.coerce.number().int().min(0),
});
type FormValues = z.infer<typeof schema>;

export function ProductsPage() {
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState("");
  const [searchInput, setSearchInput] = useState("");
  const [lowOnly, setLowOnly] = useState(false);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<Product | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const token = useAppSelector((s) => s.auth.token);

  const { data, isLoading, isError, error, refetch } = useProductsQuery({
    page,
    page_size: 20,
    search: search || undefined,
    low_stock: lowOnly || undefined,
  });
  const [createProduct, createState] = useCreateProductMutation();
  const [updateProduct, updateState] = useUpdateProductMutation();
  const [deleteProduct] = useDeleteProductMutation();
  const [importCsv, importState] = useImportProductsCsvMutation();

  const form = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: { unit: "adet", min_stock_threshold: 0 },
  });

  const openCreate = () => {
    setEditing(null);
    form.reset({ sku: "", name: "", unit: "adet", barcode: "", description: "", min_stock_threshold: 0 });
    setDialogOpen(true);
  };

  const openEdit = (product: Product) => {
    setEditing(product);
    form.reset({
      sku: product.sku,
      name: product.name,
      unit: product.unit,
      barcode: product.barcode ?? "",
      description: product.description ?? "",
      min_stock_threshold: product.min_stock_threshold,
    });
    setDialogOpen(true);
  };

  const onSubmit = form.handleSubmit(async (values) => {
    const payload = {
      ...values,
      barcode: values.barcode || null,
      description: values.description || null,
    };
    try {
      if (editing) {
        await updateProduct({ id: editing.id, ...payload }).unwrap();
        toast.success("Ürün güncellendi");
      } else {
        await createProduct(payload).unwrap();
        toast.success("Ürün eklendi");
      }
      setDialogOpen(false);
    } catch (err) {
      toast.error(apiErrorMessage(err as Parameters<typeof apiErrorMessage>[0]));
    }
  });

  const onImport = async (file: File | undefined) => {
    if (!file) return;
    try {
      const result = await importCsv(file).unwrap();
      toast.success(`CSV işlendi: ${result.created} yeni, ${result.updated} güncellendi`);
      result.errors.slice(0, 3).forEach((e) => toast.warning(e));
      if (result.errors.length > 3) toast.warning(`… ve ${result.errors.length - 3} hata daha`);
    } catch (err) {
      toast.error(apiErrorMessage(err as Parameters<typeof apiErrorMessage>[0]));
    } finally {
      if (fileRef.current) fileRef.current.value = "";
    }
  };

  const exportCsv = async () => {
    const response = await fetch("/api/v1/products/export-csv", {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!response.ok) {
      toast.error("Dışa aktarma başarısız oldu.");
      return;
    }
    const blob = await response.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "urunler.csv";
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div>
      <PageHeader
        title="Ürünler"
        description="SKU kataloğu; stok toplamları tüm depolardan hesaplanır."
        actions={
          <>
            <input
              ref={fileRef}
              type="file"
              accept=".csv"
              className="hidden"
              onChange={(e) => void onImport(e.target.files?.[0])}
            />
            <Button variant="secondary" onClick={() => fileRef.current?.click()} disabled={importState.isLoading}>
              <FileUp size={14} /> CSV içe aktar
            </Button>
            <Button variant="secondary" onClick={() => void exportCsv()}>
              <Download size={14} /> CSV dışa aktar
            </Button>
            <Button onClick={openCreate}>
              <Plus size={14} /> Ürün ekle
            </Button>
          </>
        }
      />

      <div className="mb-3 flex flex-wrap items-center gap-2">
        <form
          className="relative w-72 max-w-full"
          onSubmit={(e) => {
            e.preventDefault();
            setPage(1);
            setSearch(searchInput.trim());
          }}
        >
          <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-text-faint" />
          <Input
            value={searchInput}
            onChange={(e) => setSearchInput(e.target.value)}
            placeholder="SKU, ad veya barkod ara"
            className="pl-8"
            aria-label="Ürün ara"
          />
        </form>
        <label className="flex cursor-pointer items-center gap-1.5 text-[12.5px] text-text-muted">
          <input
            type="checkbox"
            checked={lowOnly}
            onChange={(e) => {
              setPage(1);
              setLowOnly(e.target.checked);
            }}
            className="accent-[#5e8bff]"
          />
          Sadece düşük stok
        </label>
      </div>

      {isLoading ? (
        <LoadingRows />
      ) : isError ? (
        <ErrorState message={apiErrorMessage(error)} onRetry={refetch} />
      ) : !data || data.items.length === 0 ? (
        <EmptyState
          title={search ? "Eşleşen ürün yok" : "Henüz ürün yok"}
          hint={
            search
              ? "Aramayı temizleyin ya da farklı bir terim deneyin."
              : "Ürün ekleyin ya da mevcut kataloğunuzu CSV ile içe aktarın."
          }
          action={!search ? <Button onClick={openCreate}><Plus size={14} /> Ürün ekle</Button> : undefined}
        />
      ) : (
        <>
          <DataTable>
            <THead>
              <Th>SKU</Th>
              <Th>Ürün</Th>
              <Th>Birim</Th>
              <Th className="text-right">Toplam stok</Th>
              <Th className="text-right">Eşik</Th>
              <Th>Durum</Th>
              <Th className="w-20" />
            </THead>
            <tbody>
              {data.items.map((p) => (
                <Tr key={p.id}>
                  <Td>
                    <MonoCell>{p.sku}</MonoCell>
                  </Td>
                  <Td className="font-medium">{p.name}</Td>
                  <Td className="text-text-muted">{p.unit}</Td>
                  <Td className="text-right">
                    <MonoCell>{p.total_quantity ?? 0}</MonoCell>
                  </Td>
                  <Td className="text-right">
                    <MonoCell className="text-text-muted">{p.min_stock_threshold}</MonoCell>
                  </Td>
                  <Td>
                    {p.is_low_stock ? (
                      <Badge variant="high">Düşük stok</Badge>
                    ) : (p.total_quantity ?? 0) > 0 ? (
                      <Badge variant="low">Stokta</Badge>
                    ) : (
                      <Badge>Stok yok</Badge>
                    )}
                  </Td>
                  <Td>
                    <div className="flex justify-end gap-1">
                      <Button variant="ghost" size="icon" aria-label={`${p.sku} düzenle`} onClick={() => openEdit(p)}>
                        <Pencil size={13} />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        aria-label={`${p.sku} sil`}
                        onClick={async () => {
                          if (!window.confirm(`${p.sku} silinsin mi?`)) return;
                          try {
                            await deleteProduct(p.id).unwrap();
                            toast.success("Ürün silindi");
                          } catch (err) {
                            toast.error(apiErrorMessage(err as Parameters<typeof apiErrorMessage>[0]));
                          }
                        }}
                      >
                        <Trash2 size={13} />
                      </Button>
                    </div>
                  </Td>
                </Tr>
              ))}
            </tbody>
          </DataTable>
          <Pagination page={page} pageSize={20} total={data.total} onPage={setPage} />
        </>
      )}

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent title={editing ? `Ürünü düzenle — ${editing.sku}` : "Ürün ekle"}>
          <form onSubmit={onSubmit} className="space-y-3" noValidate>
            <div className="grid grid-cols-2 gap-2">
              <div>
                <label htmlFor="p-sku" className="mb-1 block text-[12px] text-text-muted">SKU</label>
                <Input id="p-sku" className="mono" {...form.register("sku")} />
                {form.formState.errors.sku && (
                  <p className="mt-1 text-[12px] text-status-high">{form.formState.errors.sku.message}</p>
                )}
              </div>
              <div>
                <label htmlFor="p-unit" className="mb-1 block text-[12px] text-text-muted">Birim</label>
                <Input id="p-unit" placeholder="adet, kutu, metre…" {...form.register("unit")} />
              </div>
            </div>
            <div>
              <label htmlFor="p-name" className="mb-1 block text-[12px] text-text-muted">Ürün adı</label>
              <Input id="p-name" {...form.register("name")} />
              {form.formState.errors.name && (
                <p className="mt-1 text-[12px] text-status-high">{form.formState.errors.name.message}</p>
              )}
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div>
                <label htmlFor="p-barcode" className="mb-1 block text-[12px] text-text-muted">Barkod</label>
                <Input id="p-barcode" className="mono" {...form.register("barcode")} />
              </div>
              <div>
                <label htmlFor="p-threshold" className="mb-1 block text-[12px] text-text-muted">
                  Min. stok eşiği
                </label>
                <Input id="p-threshold" type="number" min={0} {...form.register("min_stock_threshold")} />
              </div>
            </div>
            <div>
              <label htmlFor="p-desc" className="mb-1 block text-[12px] text-text-muted">Açıklama</label>
              <Input id="p-desc" {...form.register("description")} />
            </div>
            <Button type="submit" className="w-full" disabled={createState.isLoading || updateState.isLoading}>
              {editing ? "Güncelle" : "Kaydet"}
            </Button>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}

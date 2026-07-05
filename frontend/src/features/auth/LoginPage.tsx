import { useForm } from "react-hook-form";
import { z } from "zod";
import { zodResolver } from "@hookform/resolvers/zod";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { useAppDispatch } from "@/app/hooks";
import { useLoginMutation } from "@/api/endpoints/auth";
import { loggedIn } from "@/features/auth/authSlice";
import { apiErrorMessage } from "@/lib/apiError";
import { AuthLayout } from "@/features/auth/AuthLayout";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

const schema = z.object({
  email: z.string().email("Geçerli bir e-posta girin"),
  password: z.string().min(1, "Şifre gerekli"),
});
type FormValues = z.infer<typeof schema>;

export function LoginPage() {
  const dispatch = useAppDispatch();
  const navigate = useNavigate();
  const location = useLocation();
  const [login, { isLoading, error }] = useLoginMutation();
  const isDemo = import.meta.env.VITE_DEMO === "1";
  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<FormValues>({
    resolver: zodResolver(schema),
    // Demo ortamında ziyaretçi tek tıkla girsin diye kimlik önceden dolu gelir.
    defaultValues: isDemo ? { email: "owner@demo.co", password: "Demo1234!" } : undefined,
  });

  const onSubmit = handleSubmit(async (values) => {
    try {
      const result = await login(values).unwrap();
      dispatch(loggedIn({ token: result.access_token, user: result.user }));
      const from = (location.state as { from?: string } | null)?.from ?? "/";
      navigate(from, { replace: true });
    } catch {
      // error rendered below
    }
  });

  return (
    <AuthLayout>
      <h1 className="mb-4 text-base font-semibold">Oturum aç</h1>
      {isDemo && (
        <p className="mb-3 rounded border border-accent/30 bg-accent/10 px-3 py-2 text-[12px] text-text-muted">
          <span className="font-medium text-accent">Demo ortamı</span> — bilgiler hazır,
          doğrudan <span className="font-medium">Oturum aç</span>'a basın. Tüm veriler
          tarayıcınızda üretilir; dilediğiniz gibi kurcalayın.
        </p>
      )}
      <form onSubmit={onSubmit} className="space-y-3" noValidate>
        <div>
          <label htmlFor="email" className="mb-1 block text-[12px] text-text-muted">
            E-posta
          </label>
          <Input id="email" type="email" autoComplete="email" {...register("email")} />
          {errors.email && <p className="mt-1 text-[12px] text-status-high">{errors.email.message}</p>}
        </div>
        <div>
          <label htmlFor="password" className="mb-1 block text-[12px] text-text-muted">
            Şifre
          </label>
          <Input id="password" type="password" autoComplete="current-password" {...register("password")} />
          {errors.password && (
            <p className="mt-1 text-[12px] text-status-high">{errors.password.message}</p>
          )}
        </div>
        {error && <p className="text-[12px] text-status-high">{apiErrorMessage(error)}</p>}
        <Button type="submit" className="w-full" disabled={isLoading}>
          {isLoading ? "Kontrol ediliyor…" : "Oturum aç"}
        </Button>
      </form>
      <p className="mt-4 text-center text-[12px] text-text-muted">
        Hesabınız yok mu?{" "}
        <Link to="/register" className="text-accent hover:underline">
          Organizasyon oluşturun
        </Link>
      </p>
    </AuthLayout>
  );
}

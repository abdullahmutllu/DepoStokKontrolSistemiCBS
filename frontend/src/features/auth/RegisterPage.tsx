import { useForm } from "react-hook-form";
import { z } from "zod";
import { zodResolver } from "@hookform/resolvers/zod";
import { Link, useNavigate } from "react-router-dom";
import { useAppDispatch } from "@/app/hooks";
import { useRegisterMutation } from "@/api/endpoints/auth";
import { loggedIn } from "@/features/auth/authSlice";
import { apiErrorMessage } from "@/lib/apiError";
import { AuthLayout } from "@/features/auth/AuthLayout";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

const schema = z.object({
  organization_name: z.string().min(1, "Organizasyon adı gerekli"),
  email: z.string().email("Geçerli bir e-posta girin"),
  password: z.string().min(8, "Şifre en az 8 karakter olmalı"),
});
type FormValues = z.infer<typeof schema>;

export function RegisterPage() {
  const dispatch = useAppDispatch();
  const navigate = useNavigate();
  const [registerAccount, { isLoading, error }] = useRegisterMutation();
  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<FormValues>({ resolver: zodResolver(schema) });

  const onSubmit = handleSubmit(async (values) => {
    try {
      const result = await registerAccount(values).unwrap();
      dispatch(loggedIn({ token: result.access_token, user: result.user }));
      navigate("/", { replace: true });
    } catch {
      // error rendered below
    }
  });

  return (
    <AuthLayout>
      <h1 className="mb-1 text-base font-semibold">Organizasyon oluştur</h1>
      <p className="mb-4 text-[12px] text-text-muted">
        Depolarınız ve ekibiniz bu organizasyon altında toplanır.
      </p>
      <form onSubmit={onSubmit} className="space-y-3" noValidate>
        <div>
          <label htmlFor="organization_name" className="mb-1 block text-[12px] text-text-muted">
            Organizasyon adı
          </label>
          <Input id="organization_name" placeholder="Örn. Demir Hırdavat A.Ş." {...register("organization_name")} />
          {errors.organization_name && (
            <p className="mt-1 text-[12px] text-status-high">{errors.organization_name.message}</p>
          )}
        </div>
        <div>
          <label htmlFor="reg-email" className="mb-1 block text-[12px] text-text-muted">
            E-posta
          </label>
          <Input id="reg-email" type="email" autoComplete="email" {...register("email")} />
          {errors.email && <p className="mt-1 text-[12px] text-status-high">{errors.email.message}</p>}
        </div>
        <div>
          <label htmlFor="reg-password" className="mb-1 block text-[12px] text-text-muted">
            Şifre
          </label>
          <Input id="reg-password" type="password" autoComplete="new-password" {...register("password")} />
          {errors.password && (
            <p className="mt-1 text-[12px] text-status-high">{errors.password.message}</p>
          )}
        </div>
        {error && <p className="text-[12px] text-status-high">{apiErrorMessage(error)}</p>}
        <Button type="submit" className="w-full" disabled={isLoading}>
          {isLoading ? "Oluşturuluyor…" : "Oluştur ve başla"}
        </Button>
      </form>
      <p className="mt-4 text-center text-[12px] text-text-muted">
        Zaten hesabınız var mı?{" "}
        <Link to="/login" className="text-accent hover:underline">
          Oturum açın
        </Link>
      </p>
    </AuthLayout>
  );
}

import { Navigate, Route, Routes, useLocation } from 'react-router-dom';
import { Layout } from './components/Layout.tsx';
import { Loading } from './components/ui.tsx';
import { LoginPage } from './pages/Login.tsx';
import { NewProductPage } from './pages/ProductForm.tsx';
import { ProductsPage } from './pages/Products.tsx';
import { ProfilePage } from './pages/Profile.tsx';
import { useSession } from './session.tsx';

function RequireLogin() {
  const { user, checking } = useSession();
  const location = useLocation();
  if (checking) {
    return (
      <div className="boot">
        <Loading />
      </div>
    );
  }
  if (!user) return <Navigate to="/kirish" replace state={{ from: location.pathname + location.search }} />;
  return <Layout />;
}

export function App() {
  return (
    <Routes>
      <Route path="/kirish" element={<LoginPage />} />
      <Route element={<RequireLogin />}>
        {/* Asosiy sahifa — mahsulotlar */}
        <Route index element={<Navigate to="/mahsulotlar" replace />} />
        <Route path="mahsulotlar" element={<ProductsPage />} />
        <Route path="mahsulotlar/yangi" element={<NewProductPage />} />
        <Route path="profil" element={<ProfilePage />} />
        <Route path="uzum" element={<Navigate to="/profil" replace />} />
        <Route path="*" element={<Navigate to="/mahsulotlar" replace />} />
      </Route>
    </Routes>
  );
}

import { Navigate, Route, Routes, useLocation } from 'react-router-dom';
import { Layout } from './components/Layout.tsx';
import { Loading } from './components/ui.tsx';
import { HistoryPage } from './pages/History.tsx';
import { HomePage } from './pages/Home.tsx';
import { LoginPage } from './pages/Login.tsx';
import { EntryPage } from './pages/Entry.tsx';
import { ProductDetailPage } from './pages/ProductDetail.tsx';
import { EditProductPage, NewProductPage } from './pages/ProductForm.tsx';
import { ProductsPage } from './pages/Products.tsx';
import { UzumPage } from './pages/Uzum.tsx';
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
        <Route index element={<HomePage />} />
        <Route path="kiritish/:slug" element={<EntryPage />} />
        <Route path="mahsulotlar" element={<ProductsPage />} />
        <Route path="mahsulotlar/yangi" element={<NewProductPage />} />
        <Route path="mahsulotlar/:id" element={<ProductDetailPage />} />
        <Route path="mahsulotlar/:id/tahrirlash" element={<EditProductPage />} />
        <Route path="tarix" element={<HistoryPage />} />
        <Route path="uzum" element={<UzumPage />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Route>
    </Routes>
  );
}

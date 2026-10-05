// Avtorizatsiya shartnomasi. Hozir bitta akkaunt; keyin ko'p foydalanuvchili provayder shu interfeysni amalga oshiradi.

export interface User {
  id: string;
  login: string;
  displayName: string;
}

export interface AuthProvider {
  /** Login va parol to'g'ri bo'lsa — foydalanuvchi, aks holda null. */
  authenticate(login: string, password: string): Promise<User | null>;
  /** Sessiyadagi id bo'yicha foydalanuvchini qaytaradi (o'chirilgan bo'lsa — null). */
  getUser(id: string): Promise<User | null>;
}

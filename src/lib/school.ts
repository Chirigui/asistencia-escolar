// La ruta del escudo debe corresponder a un archivo dentro de public/.
export const school = {
  name: process.env.NEXT_PUBLIC_SCHOOL_NAME?.trim() || "Portal escolar",
  logo: process.env.NEXT_PUBLIC_SCHOOL_LOGO?.trim() || "",
  color: process.env.NEXT_PUBLIC_SCHOOL_COLOR?.trim() || "#14554d",
};

import { GraduationCap } from "lucide-react";
import { school } from "@/lib/school";

export default function SchoolMark() {
  return school.logo ? (
    // El escudo local ya tiene dimensiones fijas en la cabecera.
    <img alt="" src={school.logo} width={40} height={40} className="size-10 object-contain" />
  ) : (
    <span aria-hidden="true" className="school-mark">
      <GraduationCap size={22} />
    </span>
  );
}

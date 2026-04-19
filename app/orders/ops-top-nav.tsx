import Link from "next/link";

const navItems = [
  { href: "/orders", label: "Orders", key: "orders" },
  { href: "/orders/files", label: "Uploads", key: "uploads" },
  { href: "/orders/generated", label: "Generated", key: "generated" },
  { href: "/etsy", label: "Etsy Pilot", key: "etsy" }
] as const;

export function OpsTopNav({ active }: { active: (typeof navItems)[number]["key"] }) {
  return (
    <nav className="opsTopNav" aria-label="Operations navigation">
      {navItems.map((item) => (
        <Link
          key={item.href}
          href={item.href}
          className={item.key === active ? "button" : "buttonSecondary"}
        >
          {item.label}
        </Link>
      ))}
      <form action="/api/admin/logout" method="post">
        <button type="submit" className="buttonSecondary">
          Sign out
        </button>
      </form>
    </nav>
  );
}

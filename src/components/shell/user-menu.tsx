import { LogOut, UserRound } from "lucide-react";
import Link from "next/link";
import { logout } from "@/app/actions/auth";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { initials } from "@/lib/format";
import { cn } from "@/lib/utils";

export function UserAvatar({ name, className }: { name: string; className?: string }) {
  return (
    <Avatar className={cn("size-9", className)}>
      <AvatarFallback className="bg-primary/10 text-sm font-medium text-primary">
        {initials(name)}
      </AvatarFallback>
    </Avatar>
  );
}

export function SidebarUserActions() {
  return (
    <div className="flex flex-col gap-1">
      <Link
        href="/profil"
        className="flex min-h-10 items-center gap-3 rounded-xl px-3 text-sm text-sidebar-foreground/70 hover:bg-sidebar-accent hover:text-sidebar-foreground"
      >
        <UserRound className="size-[18px]" strokeWidth={1.8} />
        Profilim
      </Link>
      <form action={logout}>
        <button
          type="submit"
          className="flex min-h-10 w-full items-center gap-3 rounded-xl px-3 text-sm text-sidebar-foreground/70 hover:bg-sidebar-accent hover:text-sidebar-foreground"
        >
          <LogOut className="size-[18px]" strokeWidth={1.8} />
          Çıkış yap
        </button>
      </form>
    </div>
  );
}

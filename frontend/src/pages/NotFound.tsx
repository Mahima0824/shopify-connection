import { Link } from "react-router-dom";
import { buttonVariants } from "../components/primitives";

export default function NotFound() {
  return (
    <div className="mx-auto flex max-w-md flex-col items-center justify-center py-24 text-center px-4">
      <h1 className="font-bold tracking-tight text-foreground text-3xl mb-2">Page not found</h1>
      <p className="text-muted-foreground text-base mb-6">The page you are looking for does not exist.</p>
      <Link to="/" className={buttonVariants({ variant: "outline", size: "lg" })}>
        Go home
      </Link>
    </div>
  );
}

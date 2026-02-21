/**
 * Broker logo components for portfolio tabs.
 * Maps portfolio names to their respective broker logos.
 */

// Saxo Bank logo — blue S mark
export function SaxoLogo({ className = "w-4 h-4" }: { className?: string }) {
    return (
        <svg viewBox="0 0 40 40" className={className} xmlns="http://www.w3.org/2000/svg">
            <rect width="40" height="40" rx="6" fill="#0033A0" />
            <text
                x="20"
                y="29"
                textAnchor="middle"
                fill="white"
                fontFamily="Arial, sans-serif"
                fontWeight="900"
                fontSize="28"
            >
                S
            </text>
        </svg>
    );
}

// Interactive Brokers logo — red IB mark
export function IBKRLogo({ className = "w-4 h-4" }: { className?: string }) {
    return (
        <svg viewBox="0 0 40 40" className={className} xmlns="http://www.w3.org/2000/svg">
            <rect width="40" height="40" rx="6" fill="#D42E12" />
            <text
                x="20"
                y="28"
                textAnchor="middle"
                fill="white"
                fontFamily="Arial, sans-serif"
                fontWeight="800"
                fontSize="20"
            >
                IB
            </text>
        </svg>
    );
}

/**
 * Get the appropriate broker logo component for a portfolio.
 */
export function getBrokerForPortfolio(portfolio: { name: string; description?: string | null }): "saxo" | "ibkr" | null {
    if (portfolio.description && (portfolio.description.toLowerCase() === "saxo" || portfolio.description.toLowerCase() === "ibkr")) {
        return portfolio.description.toLowerCase() as "saxo" | "ibkr";
    }
    const name = portfolio.name.toLowerCase();
    if (name.includes("pea") || name.includes("crédit") || name.includes("credit")) {
        return "saxo";
    }
    if (name.includes("cto") || name.includes("ibkr") || name.includes("interactive")) {
        return "ibkr";
    }
    return null;
}

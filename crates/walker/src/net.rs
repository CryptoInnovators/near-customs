#[cfg(not(feature = "testnet"))]
pub const WRAP: &str = "wrap.near";
#[cfg(feature = "testnet")]
pub const WRAP: &str = "wrap.testnet";

pub const INTENTS: &str = "intents.near";

#[cfg(not(feature = "testnet"))]
pub const TX_HOST: &str = "https://tx.main.fastnear.com";
#[cfg(feature = "testnet")]
pub const TX_HOST: &str = "https://tx.test.fastnear.com";

#[cfg(not(feature = "testnet"))]
pub const TX_TRANSACTIONS: &str = "https://tx.main.fastnear.com/v0/transactions";
#[cfg(feature = "testnet")]
pub const TX_TRANSACTIONS: &str = "https://tx.test.fastnear.com/v0/transactions";
#[cfg(not(feature = "testnet"))]
pub const TX_ACCOUNT: &str = "https://tx.main.fastnear.com/v0/account";
#[cfg(feature = "testnet")]
pub const TX_ACCOUNT: &str = "https://tx.test.fastnear.com/v0/account";

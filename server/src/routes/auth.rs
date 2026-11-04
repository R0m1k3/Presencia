use super::Ctx;
use crate::error::ApiResult;
pub async fn login(_: &Ctx) -> ApiResult { Ok(super::route_unknown()) }
pub async fn logout(_: &Ctx) -> ApiResult { Ok(super::route_unknown()) }
pub async fn me(_: &Ctx) -> ApiResult { Ok(super::route_unknown()) }
pub async fn password(_: &Ctx) -> ApiResult { Ok(super::route_unknown()) }

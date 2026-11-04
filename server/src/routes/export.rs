use super::Ctx;
use crate::error::ApiResult;
pub async fn excel(_: &Ctx) -> ApiResult { Ok(super::route_unknown()) }
pub async fn pdf(_: &Ctx) -> ApiResult { Ok(super::route_unknown()) }

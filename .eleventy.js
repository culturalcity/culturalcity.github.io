// 11ty 設定檔
// 文件: https://www.11ty.dev/docs/config/

module.exports = function(eleventyConfig) {
  // 把 global.css 和 favicon 等靜態檔複製到輸出目錄
  eleventyConfig.addPassthroughCopy("global.css");
  eleventyConfig.addPassthroughCopy("notice.css");
  eleventyConfig.addPassthroughCopy("regulations.css");
  eleventyConfig.addPassthroughCopy("finance.css");
  eleventyConfig.addPassthroughCopy("minutes.css");
  eleventyConfig.addPassthroughCopy("favicon.svg");
  eleventyConfig.addPassthroughCopy("favicon.png");
  eleventyConfig.addPassthroughCopy("CNAME");

  // 把資料 JSON 檔也複製過去
  eleventyConfig.addPassthroughCopy("utility/data");

  return {
    dir: {
      input: "src",          // 原始檔來源
      output: "_site",       // 建置輸出
      includes: "_includes", // 模板放這裡（路徑相對於 input）
      data: "_data"          // 資料檔放這裡（路徑相對於 input）
    },
    // 預設模板引擎：Nunjucks（.njk 檔）
    htmlTemplateEngine: "njk",
    markdownTemplateEngine: "njk"
  };
};

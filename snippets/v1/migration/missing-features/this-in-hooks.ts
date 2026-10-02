schema.pre("find", function () {
  this.where({ archived: false });
});
